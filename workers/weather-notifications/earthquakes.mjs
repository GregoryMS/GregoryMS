import core from '../../assets/earthquake-core.js';
import {send, validateSubscription} from './webpush.mjs';

const ORIGINS = ['https://earthquakes.gregle.uk'];
const MINUTE = 60000;
const defaults = {quakeNotifyEnabled:false, quakeNotifyRegional:true, quakeRegionalMagnitude:3, quakeNotifyWorldwide:true, quakeWorldwideMagnitude:6, quakeNotifyTsunami:true};
export function preferences(input = {}) {
  const output = {...defaults};
  for (const name of Object.keys(defaults)) {
    if (name.endsWith('Magnitude')) {
      const value = Number(input[name] ?? defaults[name]);
      if (!Number.isFinite(value) || value < 1 || value > 9 || value * 2 !== Math.round(value * 2)) throw Error('Invalid minimum magnitude');
      output[name] = value;
    } else {
      if (input[name] !== undefined && typeof input[name] !== 'boolean') throw Error('Invalid notification preference');
      output[name] = input[name] ?? defaults[name];
    }
  }
  return output;
}
export function inRegional(event) {
  return event.latitude >= 40 && event.latitude <= 65 && event.longitude >= -160 && event.longitude <= -115;
}
export function earthquakeEvents(events, prefs, started, now) {
  if (!prefs.quakeNotifyEnabled) return [];
  return events.filter(event => event.time >= started && event.time >= now - 86400000 && event.time <= now + MINUTE && (
    (prefs.quakeNotifyRegional && inRegional(event) && event.magnitude >= prefs.quakeRegionalMagnitude) ||
    (prefs.quakeNotifyWorldwide && event.magnitude >= prefs.quakeWorldwideMagnitude)
  )).map(event => ({id:'quake:' + event.id, title:`M${event.magnitude.toFixed(1)} earthquake`, body:`${event.place} · ${new Date(event.time).toISOString().replace('T',' ').slice(0,16)} UTC`.slice(0,500), url:event.url}));
}
export function parseBulletinScript(text, product) {
  // Accept NOAA's data assignment only. Never execute remote JavaScript.
  const source = text.replace(/^\s*\/\/[^\n]*(?:\n|$)/gm,'').trim();
  const match = source.match(new RegExp('^var\\s+' + product + '\\s*=\\s*([\\s\\S]+?)\\s*;?\\s*$'));
  if (!match) throw Error('Invalid NOAA bulletin assignment');
  // NOAA publishes JavaScript numeric literals such as 28. in coordinate fields.
  // Normalise those tokens outside strings, leaving the rest strict JSON.
  const json = match[1].replace(/"(?:\\.|[^"\\])*"|(-?\d+)\.(?=\s*[,}\]])/g, (token, integer) => integer === undefined ? token : integer + '.0');
  return core.tsunamiBulletin(JSON.parse(json), product);
}
export function tsunamiEvents(bulletins, prefs) {
  if (!prefs.quakeNotifyEnabled || !prefs.quakeNotifyTsunami) return [];
  return bulletins.filter(item => item.kind).map(item => ({
    id:`tsunami:${item.id}:${item.issued}:${item.kind}`, title:`Tsunami ${item.kind.toLowerCase()}`,
    body:[item.place, ...item.areas].join(' · ').slice(0,600), url:item.links[0]?.url || 'https://www.tsunami.gov/',
  }));
}
async function readFeed(url, json = true) {
  const response = await fetch(url, {headers:{'User-Agent':'GregleEarthquakeNotifications/1.0 (https://earthquakes.gregle.uk/)'},signal:AbortSignal.timeout(12000), cf:{cacheTtl:30, cacheEverything:true}});
  if (!response.ok) { await response.body?.cancel(); throw Error('Earthquake or tsunami feed unavailable (HTTP '+response.status+')'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.length;
    if (size > 4000000) { await reader.cancel(); throw Error('Feed too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  return json ? JSON.parse(text) : text;
}
async function remove(env, endpoint) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM quake_deliveries WHERE endpoint=?').bind(endpoint),
    env.DB.prepare('DELETE FROM quake_subscriptions WHERE endpoint=?').bind(endpoint),
  ]);
}
async function deliver(env, row, event, now) {
  const claim = await env.DB.prepare('INSERT INTO quake_deliveries(endpoint,event_id,sent_at,status) VALUES(?,?,?,0) ON CONFLICT(endpoint,event_id) DO UPDATE SET sent_at=excluded.sent_at WHERE quake_deliveries.status=0 AND quake_deliveries.sent_at<?').bind(row.endpoint,event.id,now,now-2*MINUTE).run();
  if (!claim.meta.changes) return true;
  try {
    const current = await env.DB.prepare('SELECT updated_at FROM quake_subscriptions WHERE endpoint=?').bind(row.endpoint).first();
    if (!current || current.updated_at !== row.updated_at) {
      await env.DB.prepare('DELETE FROM quake_deliveries WHERE endpoint=? AND event_id=? AND status=0').bind(row.endpoint,event.id).run(); return false;
    }
    const response = await send(env,row,{title:event.title,body:event.body,url:event.url,tag:event.id});
    if ([404,410].includes(response.status)) { await response.body?.cancel(); await remove(env,row.endpoint); return false; }
    await response.body?.cancel();
    if (!response.ok) throw Error('Push service rejected delivery');
    await env.DB.prepare('UPDATE quake_deliveries SET status=1 WHERE endpoint=? AND event_id=?').bind(row.endpoint,event.id).run();
    return true;
  } catch (error) {
    await env.DB.prepare('DELETE FROM quake_deliveries WHERE endpoint=? AND event_id=? AND status=0').bind(row.endpoint,event.id).run();
    throw error;
  }
}
export async function tick(env, now = Date.now()) {
  let failures = 0, checked = 0, earthquakes = [], bulletins = [];
  try {
    const data = await readFeed('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
    if (data.metadata?.generated < now - 10*MINUTE || data.metadata?.generated > now + MINUTE) throw Error('Stale USGS feed');
    earthquakes = core.earthquakes(data);
  } catch (_) { failures++; console.warn(JSON.stringify({event:'earthquake_feed_unavailable'})); }
  // Check every regional NOAA product, including international threat bulletins.
  const results = await Promise.allSettled(core.tsunamiProducts.map(async product => parseBulletinScript(await readFeed(`https://www.tsunami.gov/events/js/${product}.js`,false),product)));
  for (const result of results) {
    if (result.status === 'fulfilled') bulletins.push(result.value);
    else failures++;
  }
  let after = '';
  do {
    const {results:rows} = await env.DB.prepare('SELECT * FROM quake_subscriptions WHERE endpoint>? ORDER BY endpoint LIMIT 50').bind(after).all();
    if (!rows.length) break;
    for (const row of rows) {
      after = row.endpoint; checked++;
      try {
        const prefs = preferences(JSON.parse(row.prefs));
        const events = [...earthquakeEvents(earthquakes,prefs,row.started_at,now), ...tsunamiEvents(bulletins,prefs)];
        for (const event of events) if (!await deliver(env,row,event,now)) break;
      } catch (_) { failures++; console.error(JSON.stringify({event:'earthquake_notification_failed'})); }
    }
    if (rows.length < 50) break;
  } while (true);
  const state = {at:now,checked,failures,earthquakes:earthquakes.length,tsunamiProducts:bulletins.length};
  await env.DB.batch([
    env.DB.prepare('DELETE FROM quake_deliveries WHERE sent_at<?').bind(now-30*86400000),
    env.DB.prepare("INSERT INTO service_state(key,value) VALUES('earthquake_check',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(state)),
  ]);
  console.log(JSON.stringify({event:'earthquake_notification_check_complete',...state}));
}
async function body(req) {
  const text = await readBody(req);
  return JSON.parse(text);
}
async function readBody(req) {
  const reader = req.body?.getReader(); if (!reader) throw Error('Missing request body');
  const chunks = []; let length = 0;
  while (true) {
    const {value,done} = await reader.read(); if (done) break; length += value.length;
    if (length > 12000) { await reader.cancel(); throw Error('Request too large'); } chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
async function handle(req, env) {
  const origin = req.headers.get('origin'), path = new URL(req.url).pathname.replace(/^\/earthquakes/,'');
  const reply = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store',Vary:'Origin',...(ORIGINS.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
  if (origin && !ORIGINS.includes(origin)) return reply({error:'Origin not allowed'},403);
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin || ORIGINS[0],'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type',Vary:'Origin'}});
  const ready = Boolean(env.VAPID_PRIVATE && env.VAPID_PUBLIC);
  if (req.method === 'GET' && path === '/public-key') return reply({publicKey:env.VAPID_PUBLIC,ready});
  if (req.method === 'GET' && path === '/health') {
    const state = await env.DB.prepare("SELECT value FROM service_state WHERE key='earthquake_check'").first();
    return reply({ok:ready,ready,lastCheck:state ? JSON.parse(state.value) : null},ready?200:503);
  }
  if (req.method !== 'POST' || !['/subscribe','/unsubscribe','/test'].includes(path)) return reply({error:'Not found'},404);
  if (!ready) return reply({error:'Notification service is not configured'},503);
  let data;
  try { data = await body(req); } catch (_) { return reply({error:'Invalid request body'},400); }
  const sub = data?.subscription;
  if (!await validateSubscription(sub)) return reply({error:'Invalid push subscription'},400);
  try {
    const row = await env.DB.prepare('SELECT * FROM quake_subscriptions WHERE endpoint=? AND auth=? AND p256dh=?').bind(sub.endpoint,sub.keys.auth,sub.keys.p256dh).first();
    if (path === '/unsubscribe') { if (row) await remove(env,row.endpoint); return reply({ok:true}); }
    if (path === '/test') {
      if (!row) return reply({error:'Enable notifications before sending a test'},404);
      const now=Date.now(), event={id:'test:'+Math.floor(now/MINUTE),title:'Gregle Earthquakes',body:'Earthquake and tsunami notifications are working on this device.',url:'https://earthquakes.gregle.uk/'};
      if (!await deliver(env,row,event,now)) return reply({error:'Subscription expired. Retry connection.'},410);
      return reply({ok:true});
    }
    let prefs;
    try { prefs = preferences(data.preferences); } catch (error) { return reply({error:error.message},400); }
    if (!row && await env.DB.prepare('SELECT endpoint FROM quake_subscriptions WHERE endpoint=?').bind(sub.endpoint).first()) return reply({error:'Subscription does not match this device'},403);
    if (!prefs.quakeNotifyEnabled) { if (row) await remove(env,row.endpoint); return reply({ok:true}); }
    const now = Date.now();
    await env.DB.prepare('INSERT INTO quake_subscriptions(endpoint,p256dh,auth,prefs,started_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET prefs=excluded.prefs,updated_at=excluded.updated_at').bind(sub.endpoint,sub.keys.p256dh,sub.keys.auth,JSON.stringify(prefs),now,now).run();
    return reply({ok:true});
  } catch (_) {
    console.error(JSON.stringify({event:'earthquake_notification_request_failed',path}));
    return reply({error:'Notification service temporarily unavailable. Retry connection.'},503);
  }
}
export default {fetch:handle,tick};
