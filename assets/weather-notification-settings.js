(() => {
  'use strict';
  const API = 'https://gregle-weather-notifications.square-rain-5ded.workers.dev';
  const key = 'gregle-weather-notification-preferences-v1';
  const defaults = {weatherNotifyEnabled:false, weatherNotifyCity:'selected', weatherNotifySunrise:true, weatherSunriseLead:'15', weatherNotifySunset:true, weatherSunsetLead:'15', weatherNotifyRain:true, weatherNotifyWarnings:true};
  const cities = {
    victoria:{name:'Victoria', latitude:48.421, longitude:-123.393, country:'CA', timezone:'America/Vancouver', id:'bc-75'},
    vancouver:{name:'Vancouver', latitude:49.24, longitude:-123.12, country:'CA', timezone:'America/Vancouver', id:'bc-74'},
    oslo:{name:'Oslo', latitude:59.9139, longitude:10.7522, country:'NO', timezone:'Europe/Oslo'},
    london:{name:'London', latitude:51.5085, longitude:-0.1257, country:'GB', timezone:'Europe/London'},
  };
  const bytes = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0));
  function init() {
    const $ = id => document.getElementById(id), panel = $('weatherSettingsPanel'), trigger = $('weatherSettingsTrigger');
    if (!panel || !trigger) return;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
    const prefs = {...defaults, ...(saved && typeof saved === 'object' ? saved : {})};
    let registration, publicKey, subscription, busy = false, connected = false;
    let selected = globalThis.GregleWeatherSelectedLocation;
    let queue = Promise.resolve(), subscriptionTask;
    const status = message => {
      $('weatherPushStatus').textContent = message;
      $('weatherPushActionStatus').textContent = message;
    };
    function updateActions() {
      $('weatherPushEnable').hidden = Boolean(prefs.weatherNotifyEnabled);
      $('weatherPushEnable').disabled = busy || !registration || !publicKey || Boolean(unsupported());
      $('weatherPushTest').disabled = busy || !connected || !prefs.weatherNotifyEnabled;
      $('weatherPushRetry').disabled = busy;
    }
    const persist = () => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_) {} };
    const monitored = () => {
      const loc = cities[prefs.weatherNotifyCity] || selected;
      return loc ? {...loc, timezone:loc.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} : null;
    };
    function describeLocation() {
      const location = monitored();
      $('weatherNotifyLocationStatus').textContent = location
        ? `Notification location: ${location.name}.` + (!['CA','GB'].includes(location.country) ? ' Official warning alerts are not available here.' : '')
        : 'Choose a location in Weather before enabling notifications.';
    }
    function position() { panel.style.setProperty('--weather-settings-top', Math.max(8, trigger.getBoundingClientRect().bottom + 10) + 'px'); }
    function close(focus = false) { panel.hidden = true; trigger.setAttribute('aria-expanded','false'); if (focus) trigger.focus(); }
    trigger.addEventListener('click', () => {
      if (!panel.hidden) return close(true);
      const menu = $('gregleAppMenu'); if (menu) menu.open = false;
      position(); panel.hidden = false; trigger.setAttribute('aria-expanded','true'); $('weatherSettingsClose').focus();
    });
    $('weatherSettingsClose').addEventListener('click', () => close(true));
    $('gregleAppMenu')?.addEventListener('toggle', event => { if (event.target.open) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); } });
    document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(); });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', () => { if (!panel.hidden) position(); }, {passive:true});
    for (const id of Object.keys(defaults)) {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = Boolean(prefs[id]); else { el.value = String(prefs[id]); if (!el.value) el.value = defaults[id]; }
      prefs[id] = el.type === 'checkbox' ? el.checked : el.value;
      el.addEventListener('change', () => {
        prefs[id] = el.type === 'checkbox' ? el.checked : el.value;
        persist(); describeLocation();
        if (id === 'weatherNotifyEnabled' && prefs[id]) return enable();
        enqueue(() => sync());
      });
    }
    function unsupported() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) return 'On iPhone or iPad, add Weather to your Home Screen, open it from there, then enable notifications.';
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'This browser does not support Web Push. Open Weather in a supported browser or installed app.';
      if (Notification.permission === 'denied') return 'Notifications are blocked. Allow them in your browser or device settings, then try again.';
      return '';
    }
    function beginSubscription() {
      if (subscription) return Promise.resolve({subscription});
      if (subscriptionTask) return subscriptionTask;
      // Safari requires subscribe() itself in the tap handler. It also prompts for permission.
      try {
        subscriptionTask = Promise.resolve(registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:bytes(publicKey)}))
          .then(value => ({subscription:value}), error => ({error}));
        return subscriptionTask;
      } catch (error) { return Promise.resolve({error}); }
    }
    function enable() {
      const reason = unsupported();
      if (reason || !registration || !publicKey) {
        prefs.weatherNotifyEnabled = $('weatherNotifyEnabled').checked = false; persist();
        status(reason || 'Notification service is connecting. Try Enable notifications again in a moment.'); updateActions(); return;
      }
      prefs.weatherNotifyEnabled = $('weatherNotifyEnabled').checked = true; persist();
      const pending = beginSubscription();
      enqueue(() => sync(pending));
    }
    async function request(path, data) {
      const response = await fetch(API + path, {method:data ? 'POST' : 'GET', headers:data ? {'Content-Type':'application/json'} : {}, body:data ? JSON.stringify(data) : undefined, cache:'no-store', signal:AbortSignal.timeout(15000)});
      let result; try { result = await response.json(); } catch (_) { throw Error('Notification service is temporarily unavailable.'); }
      if (!response.ok) throw Error(result.error || 'Could not connect to the notification service.');
      return result;
    }
    function enqueue(task) {
      queue = queue.catch(() => {}).then(async () => { busy = true; updateActions(); await task(); }).catch(error => {
        connected = false; status(error.message || 'Could not connect. Try again.'); $('weatherPushRetry').hidden = false;
      }).finally(() => { busy = false; updateActions(); });
      return queue;
    }
    async function sync(pending) {
      connected = false; $('weatherPushTest').disabled = true;
      if (pending) {
        const result = await pending; subscriptionTask = null;
        if (result.error) {
          if (result.error.name === 'NotAllowedError') {
            prefs.weatherNotifyEnabled = $('weatherNotifyEnabled').checked = false; persist();
            throw Error('Notifications were not allowed. Check this app’s notification permission in device settings, then enable notifications again.');
          }
          throw result.error;
        }
        subscription = result.subscription;
      }
      if (!registration) return;
      subscription = await registration.pushManager.getSubscription();
      if (!prefs.weatherNotifyEnabled) {
        if (subscription) {
          // Remove server data first. Retain the subscription if offline so Retry can remove it.
          await request('/unsubscribe', {subscription:subscription.toJSON()});
          await subscription.unsubscribe(); subscription = null;
        }
        $('weatherPushRetry').hidden = true;
        status('Notifications are off. Turn on Enable notifications to send a test.'); return;
      }
      if (!subscription) {
        $('weatherPushRetry').hidden = false;
        status('Tap Retry connection to finish enabling notifications on this device.'); return;
      }
      const location = monitored();
      if (!location) throw Error('Choose a location in Weather, then retry the connection.');
      status('Saving notification preferences…');
      await request('/subscribe', {subscription:subscription.toJSON(), preferences:{...prefs}, location});
      connected = true; $('weatherPushRetry').hidden = true;
      status(`Notifications are on for ${location.name}. Send a test notification to check this device.`);
    }
    async function prepare() {
      const reason = unsupported();
      if (reason) { status(reason); return; }
      status('Connecting notification service…');
      await navigator.serviceWorker.register('/gregle-sw.js', {scope:'/', updateViaCache:'none'});
      let timeout;
      try { registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Notification setup timed out. Retry connection.')), 15000); })]); }
      finally { clearTimeout(timeout); }
      const config = await request('/public-key');
      if (!config.ready || !config.publicKey) throw Error('Notification service is temporarily unavailable. Retry connection.');
      publicKey = config.publicKey;
      subscription = await registration.pushManager.getSubscription();
      const oldKey = subscription?.options?.applicationServerKey;
      if (oldKey && Array.from(new Uint8Array(oldKey)).join() !== Array.from(bytes(publicKey)).join()) {
        await subscription.unsubscribe(); subscription = null;
      }
      await sync();
    }
    $('weatherPushEnable').addEventListener('click', enable);
    $('weatherPushRetry').addEventListener('click', () => {
      if (busy) return;
      if (!publicKey || !registration) return enqueue(prepare);
      // Retrying a missing subscription is also a fresh user gesture on iPhone.
      const pending = prefs.weatherNotifyEnabled && !subscription ? beginSubscription() : undefined;
      enqueue(() => sync(pending));
    });
    $('weatherPushTest').addEventListener('click', () => enqueue(async () => {
      if (!subscription || !connected) return;
      $('weatherPushTest').disabled = true;
      await request('/test', {subscription:subscription.toJSON()});
      status('Test notification sent. Check this device’s notifications.');
    }));
    globalThis.GregleWeatherNotifications = {setLocation(location) {
      selected = location; describeLocation();
      if (prefs.weatherNotifyEnabled && prefs.weatherNotifyCity === 'selected') enqueue(() => sync());
    }};
    window.addEventListener('online', () => enqueue(() => publicKey && registration ? sync() : prepare()));
    describeLocation(); updateActions(); enqueue(prepare);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
