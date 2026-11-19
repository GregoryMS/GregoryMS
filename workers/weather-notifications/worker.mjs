import SunCalc from '../../assets/vendor/suncalc.js';
import alerts from '../../assets/weather-alerts.js';
import weather from '../../assets/weather-core.js';
import {send, validateSubscription} from './webpush.mjs';

const ORIGINS = ['https://weather.gregle.uk', 'https://gregle.uk'];
const MINUTE = 60000;
const defaults = {weatherNotifyEnabled:false, weatherNotifySunrise:true, weatherSunriseLead:15, weatherNotifySunset:true, weatherSunsetLead:15, weatherNotifyRain:true, weatherNotifyWarnings:true};
function preferences(input = {}) {
  const output = {...defaults};
  for (const name of Object.keys(defaults)) {
    if (name.endsWith('Lead')) {
      const lead = Number(input[name] ?? defaults[name]);
      if (![0,10,15,30,60].includes(lead)) throw Error('Invalid advance notice');
      output[name] = lead;
    } else {
      if (input[name] !== undefined && typeof input[name] !== 'boolean') throw Error('Invalid notification preference');
      output[name] = input[name] ?? defaults[name];
    }
  }
  return output;
}
export function location(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !weather.coordinates(input.latitude, input.longitude)) throw Error('Invalid notification location');
  let timezone = 'UTC';
  try { if (input.timezone) { new Intl.DateTimeFormat('en', {timeZone:input.timezone}).format(); timezone = input.timezone; } } catch (_) { throw Error('Invalid time zone'); }
  return {name:input.name.trim(), latitude:input.latitude, longitude:input.longitude, country:/^[A-Z]{2}$/.test(input.country || '') ? input.country : null, timezone,
    ...(/^[a-z]{2}-[a-z0-9]+$/.test(input.id || '') ? {id:input.id} : {})};
}
export function weatherURL(loc) {
  const url = new URL('https://weather.gregle.uk/');
  for (const [key, value] of Object.entries({lat:loc.latitude, lon:loc.longitude, name:loc.name, country:loc.country || '', tz:loc.timezone})) url.searchParams.set(key, value);
  return url.href;
}
export function sunEvents(loc, prefs, now) {
  const events = [];
  for (let day = -1; day <= 1; day++) {
    const times = SunCalc.getTimes(new Date(now + day * 86400000), loc.latitude, loc.longitude);
    for (const [kind, enabled, lead] of [['sunrise', prefs.weatherNotifySunrise, prefs.weatherSunriseLead], ['sunset', prefs.weatherNotifySunset, prefs.weatherSunsetLead]]) {
      const at = times[kind]?.getTime(), due = at - lead * MINUTE;
      if (!enabled || !Number.isFinite(at) || due > now || now - due >= 6 * MINUTE || at < now - 6 * MINUTE) continue;
      const label = kind === 'sunrise' ? 'Sunrise' : 'Sunset';
      const time = new Date(at).toLocaleTimeString('en-CA', {hour:'2-digit', minute:'2-digit', timeZone:loc.timezone});
      const remaining = Math.max(0, Math.round((at - now) / MINUTE));
      events.push({id:`${kind}:${at}`, title:remaining ? `${label} in ${remaining} minutes` : label, body:`${loc.name} · ${time}`, url:weatherURL(loc)});
    }
  }
  return events;
}
// Use a model with native 15-minute precipitation, never interpolated hourly data.
export function rainModel(loc) {
  if (loc.latitude >= 24 && loc.latitude <= 55 && loc.longitude >= -130 && loc.longitude <= -60) return 'ncep_rrfs_conus';
  if (loc.latitude >= 44 && loc.latitude <= 56 && loc.longitude >= 2 && loc.longitude <= 18) return 'icon_d2';
  return null;
}
export function rainEvent(data, loc, now, fine) {
  const series = fine ? data?.minutely_15 : data?.hourly;
  const interval = (fine ? 15 : 60) * MINUTE;
  if (!Array.isArray(series?.time) || !Array.isArray(series.rain)) throw Error('Rain forecast unavailable');
  const amount = i => typeof series.rain[i] === 'number' ? series.rain[i] + (fine ? 0 : Number(series.showers?.[i] || 0)) : null;
  for (let i = 1; i < series.time.length; i++) {
    const end = series.time[i] * 1000, start = end - interval;
    if (start < now || start > now + (fine ? 30 : 60) * MINUTE || amount(i) === null || amount(i-1) === null || amount(i) < .1 || amount(i-1) >= .1) continue;
    const from = Math.max(0, Math.floor((start - now)/MINUTE)), to = Math.ceil((end - now)/MINUTE);
    return {id:`rain:${loc.latitude},${loc.longitude}:${Math.round(start / (60*MINUTE))}`, title:'Rain expected soon', body:`${loc.name}: rain may begin in about ${from}–${to} minutes (${fine ? '15-minute' : 'hourly'} forecast).`, url:weatherURL(loc)};
  }
  return null;
}
async function getJSON(url, ttl = 240) {
  const response = await fetch(url, {signal:AbortSignal.timeout(12000), cf:{cacheTtl:ttl, cacheEverything:true}});
  if (!response.ok) throw Error('Weather provider unavailable');
  const data = await response.json(); if (data.error) throw Error('Weather provider rejected request'); return data;
}
async function rainForecast(loc) {
  const model = rainModel(loc);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude:loc.latitude, longitude:loc.longitude, timeformat:'unixtime', timezone:'UTC', hourly:'rain,showers', past_hours:'1', forecast_hours:'4', ...(model ? {models:model, minutely_15:'rain', past_minutely_15:'2', forecast_minutely_15:'16'} : {})});
  try { return {data:await getJSON(url), fine:Boolean(model)}; }
  catch (error) {
    if (!model) throw error;
    for (const key of ['models','minutely_15','past_minutely_15','forecast_minutely_15']) url.searchParams.delete(key);
    return {data:await getJSON(url), fine:false};
  }
}
async function officialWarnings(loc, getDirectory) {
  if (loc.country === 'GB') return alerts.ukAlerts(await getJSON(alerts.ukAlertsURL(loc), 120));
  if (loc.country !== 'CA') return [];
  let id = loc.id;
  if (!id) {
    id = weather.nearestStation(await getDirectory(), loc).id;
    if (id === 'bc-85') id = 'bc-75';
  }
  return alerts.activeAlerts(await getJSON('https://api.weather.gc.ca/collections/citypageweather-realtime/items/' + id + '?f=json'));
}
async function remove(env, endpoint) {
  await env.DB.batch([env.DB.prepare('DELETE FROM deliveries WHERE endpoint=?').bind(endpoint), env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(endpoint)]);
}
async function deliver(env, row, event, now) {
  // Atomic claim prevents overlapping cron executions from duplicating the same alert.
  const claim = await env.DB.prepare('INSERT INTO deliveries(endpoint,event_id,sent_at,status) VALUES(?,?,?,0) ON CONFLICT(endpoint,event_id) DO UPDATE SET sent_at=excluded.sent_at WHERE deliveries.status=0 AND deliveries.sent_at<?').bind(row.endpoint, event.id, now, now - 2*MINUTE).run();
  if (!claim.meta.changes) return true;
  try {
    const current = await env.DB.prepare('SELECT updated_at FROM subscriptions WHERE endpoint=?').bind(row.endpoint).first();
    if (!current || current.updated_at !== row.updated_at) {
      await env.DB.prepare('DELETE FROM deliveries WHERE endpoint=? AND event_id=? AND status=0').bind(row.endpoint, event.id).run(); return false;
    }
    const response = await send(env, row, {title:event.title, body:event.body, url:event.url, tag:event.id});
    if ([404,410].includes(response.status)) { await remove(env, row.endpoint); return false; }
    if (!response.ok) { await response.body?.cancel(); throw Error('Push service status ' + response.status); }
    await response.body?.cancel();
    await env.DB.prepare('UPDATE deliveries SET status=1 WHERE endpoint=? AND event_id=?').bind(row.endpoint, event.id).run();
    return true;
  } catch (error) {
    await env.DB.prepare('DELETE FROM deliveries WHERE endpoint=? AND event_id=? AND status=0').bind(row.endpoint, event.id).run();
    throw error;
  }
}
export async function tick(env, now = Date.now()) {
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC) throw Error('Push signing is not configured');
  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, Promise.resolve().then(fn)); return memo.get(key); };
  const getDirectory = () => once('directory', () => getJSON('https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=1000&properties=identifier,name.en,name.fr', 3600));
  let after = '', checked = 0, failures = 0;
  do {
    const {results:rows} = await env.DB.prepare('SELECT * FROM subscriptions WHERE endpoint>? ORDER BY endpoint LIMIT 50').bind(after).all();
    if (!rows.length) break;
    for (const row of rows) {
      after = row.endpoint; checked++;
      try {
        const prefs = preferences(JSON.parse(row.prefs)), loc = location(JSON.parse(row.location));
        if (!prefs.weatherNotifyEnabled) continue;
        const events = sunEvents(loc, prefs, now), cacheKey = [loc.latitude, loc.longitude, loc.country, loc.id].join('|');
        if (prefs.weatherNotifyRain) {
          try { const forecast = await once('rain:' + cacheKey, () => rainForecast(loc)); const event = rainEvent(forecast.data, loc, now, forecast.fine); if (event) events.push(event); }
          catch (_) { failures++; console.warn(JSON.stringify({event:'rain_forecast_unavailable'})); }
        }
        let nextWarnings;
        if (prefs.weatherNotifyWarnings && ['CA','GB'].includes(loc.country)) {
          try {
            const active = await once('warnings:' + cacheKey, () => officialWarnings(loc, getDirectory));
            const old = JSON.parse(row.pending || '[]');
            nextWarnings = active.map(alert => ({id:`warning:${alert.title}:${alert.issued}`, title:alert.title, expires:alert.expires}));
            for (const alert of nextWarnings) events.push({id:alert.id, title:alert.title.slice(0,150), body:`${loc.name} · ${loc.country === 'CA' ? 'Environment Canada' : 'Met Office'}`, url:weatherURL(loc)});
            for (const alert of old) if (!nextWarnings.some(next => next.title === alert.title)) events.push({id:'ended:' + alert.id, title:'Weather alert ended', body:`${loc.name}: ${alert.title}`.slice(0,350), url:weatherURL(loc)});
          } catch (_) { failures++; console.warn(JSON.stringify({event:'warning_feed_unavailable'})); }
        }
        let active = true;
        for (const event of events) if (!await deliver(env, row, event, now)) { active = false; break; }
        if (active && nextWarnings) await env.DB.prepare('UPDATE subscriptions SET pending=? WHERE endpoint=? AND updated_at=?').bind(JSON.stringify(nextWarnings), row.endpoint, row.updated_at).run();
      } catch (_) { failures++; console.error(JSON.stringify({event:'notification_check_failed'})); }
    }
    if (rows.length < 50) break;
  } while (true);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM deliveries WHERE sent_at<?').bind(now - 30*86400000),
    env.DB.prepare("INSERT INTO service_state(key,value) VALUES('last_check',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at:now, checked, failures})),
  ]);
  console.log(JSON.stringify({event:'notification_check_complete', checked, failures}));
}
async function body(req) {
  if (Number(req.headers.get('content-length') || 0) > 12000) throw Error('Request too large');
  const reader = req.body?.getReader(); if (!reader) throw Error('Missing request body');
  const chunks = []; let length = 0;
  while (true) { const {value,done} = await reader.read(); if (done) break; length += value.length; if (length > 12000) { await reader.cancel(); throw Error('Request too large'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin'), path = new URL(req.url).pathname;
    const reply = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store', Vary:'Origin', ...(ORIGINS.includes(origin) ? {'Access-Control-Allow-Origin':origin} : {})}});
    if (origin && !ORIGINS.includes(origin)) return reply({error:'Origin not allowed'},403);
    if (req.method === 'OPTIONS') return new Response(null, {status:204, headers:{'Access-Control-Allow-Origin':origin || ORIGINS[0], 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', Vary:'Origin'}});
    const ready = Boolean(env.VAPID_PRIVATE && env.VAPID_PUBLIC);
    if (req.method === 'GET' && path === '/public-key') return reply({publicKey:env.VAPID_PUBLIC, ready});
    if (req.method === 'GET' && path === '/health') {
      const state = await env.DB.prepare("SELECT value FROM service_state WHERE key='last_check'").first();
      return reply({ok:ready, ready, lastCheck:state ? JSON.parse(state.value) : null}, ready ? 200 : 503);
    }
    if (req.method !== 'POST' || !['/subscribe','/unsubscribe','/test'].includes(path)) return reply({error:'Not found'},404);
    if (!ready) return reply({error:'Notification service is not configured'},503);
    let data;
    try { data = await body(req); } catch (_) { return reply({error:'Invalid request body'},400); }
    const sub = data.subscription;
    if (!await validateSubscription(sub)) return reply({error:'Invalid push subscription'},400);
    try {
      const row = await env.DB.prepare('SELECT * FROM subscriptions WHERE endpoint=? AND auth=? AND p256dh=?').bind(sub.endpoint, sub.keys.auth, sub.keys.p256dh).first();
      if (path === '/unsubscribe') {
        if (row) await remove(env, row.endpoint);
        return reply({ok:true});
      }
      if (path === '/test') {
        if (!row) return reply({error:'Enable notifications before sending a test'},404);
        const event = {id:'test:' + Math.floor(Date.now()/MINUTE), title:'Gregle Weather', body:'Notifications are working on this device.', url:weatherURL(JSON.parse(row.location))};
        if (!await deliver(env,row,event,Date.now())) return reply({error:'This subscription expired. Disable and enable notifications again.'},410);
        return reply({ok:true});
      }
      let prefs, loc;
      try { prefs = preferences(data.preferences); loc = location(data.location); } catch (error) { return reply({error:error.message},400); }
      if (!row && await env.DB.prepare('SELECT endpoint FROM subscriptions WHERE endpoint=?').bind(sub.endpoint).first()) return reply({error:'Subscription does not match this device'},403);
      const json = JSON.stringify(loc), now = Date.now();
      await env.DB.prepare('INSERT INTO subscriptions(endpoint,p256dh,auth,prefs,location,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET prefs=excluded.prefs,location=excluded.location,updated_at=excluded.updated_at,pending=CASE WHEN subscriptions.location=excluded.location THEN subscriptions.pending ELSE NULL END').bind(sub.endpoint,sub.keys.p256dh,sub.keys.auth,JSON.stringify(prefs),json,now).run();
      return reply({ok:true});
    } catch (_) { console.error(JSON.stringify({event:'notification_request_failed', path})); return reply({error:'Notification service temporarily unavailable. Retry connection.'},503); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env, event.scheduledTime)); },
};
