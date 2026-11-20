(() => {
  'use strict';
  const API = '/api/earthquake-notifications';
  const sharedOrigin = ['gregle.uk','www.gregle.uk'].includes(window.location?.hostname);
  const key = 'gregle-earthquake-notification-preferences-v1';
  const defaults = {quakeNotifyEnabled:false, quakeNotifyRegional:true, quakeRegionalMagnitude:'3', quakeNotifyWorldwide:true, quakeWorldwideMagnitude:'6', quakeNotifyTsunami:true};
  const bytes = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0));
  function init() {
    const $ = id => document.getElementById(id), panel = $('quakeSettingsPanel'), trigger = $('quakeSettingsTrigger');
    if (!panel || !trigger) return;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
    const prefs = {...defaults, ...(saved && typeof saved === 'object' ? saved : {})};
    let registration, publicKey, subscription, busy = false, connected = false;
    let queue = Promise.resolve(), subscriptionTask;
    const status = message => {
      $('quakePushStatus').textContent = message;
      $('quakePushActionStatus').textContent = message;
    };
    function updateActions() {
      $('quakePushEnable').hidden = Boolean(prefs.quakeNotifyEnabled);
      $('quakePushEnable').disabled = busy || !registration || !publicKey || Boolean(unsupported());
      $('quakePushTest').disabled = busy || !connected || !prefs.quakeNotifyEnabled;
      $('quakePushRetry').disabled = busy;
      for (const id of Object.keys(defaults)) $(id).disabled = busy;
      $('quakeRegionalMagnitude').disabled = busy || !prefs.quakeNotifyRegional;
      $('quakeWorldwideMagnitude').disabled = busy || !prefs.quakeNotifyWorldwide;
    }
    const persist = () => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_) {} };
    function position() { panel.style.setProperty('--quake-settings-top', Math.max(8, trigger.getBoundingClientRect().bottom + 10) + 'px'); }
    function close(focus = false) { panel.hidden = true; trigger.setAttribute('aria-expanded','false'); if (focus) trigger.focus(); }
    trigger.addEventListener('click', () => {
      if (!panel.hidden) return close(true);
      const menu = $('gregleAppMenu'); if (menu) menu.open = false;
      position(); panel.hidden = false; trigger.setAttribute('aria-expanded','true'); $('quakeSettingsClose').focus();
    });
    $('quakeSettingsClose').addEventListener('click', () => close(true));
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
        persist();
        if (id === 'quakeNotifyEnabled' && prefs[id]) return enable();
        enqueue(() => sync());
      });
    }
    function unsupported() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) return 'On iPhone or iPad, add Earthquakes to your Home Screen, open it from there, then enable notifications.';
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'This browser does not support Web Push. Open Earthquakes in a supported browser or installed app.';
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
        prefs.quakeNotifyEnabled = $('quakeNotifyEnabled').checked = false; persist();
        status(reason || 'Notification service is connecting. Try Enable notifications again in a moment.'); updateActions(); return;
      }
      prefs.quakeNotifyEnabled = $('quakeNotifyEnabled').checked = true; persist();
      const pending = beginSubscription();
      enqueue(() => sync(pending));
    }
    async function request(path, data) {
      let response;
      try { response = await fetch(API + path, {method:data ? 'POST' : 'GET', headers:data ? {'Content-Type':'application/json'} : {}, body:data ? JSON.stringify(data) : undefined, cache:'no-store', signal:AbortSignal.timeout(15000)}); }
      catch (_) { throw Error('Could not reach the notification service. Tap Retry connection to reconnect.'); }
      let result; try { result = await response.json(); } catch (_) { throw Error('Notification service is temporarily unavailable.'); }
      if (!response.ok) {
        const error = Error(result.error || 'Could not connect to the notification service.');
        error.status = response.status; error.code = result.code;
        throw error;
      }
      return result;
    }
    function enqueue(task) {
      queue = queue.catch(() => {}).then(async () => { busy = true; updateActions(); await task(); }).catch(error => {
        connected = false; status(error.name === 'TypeError' ? 'Could not connect to notifications. Check your connection and try again.' : (error.message || 'Could not connect. Try again.')); $('quakePushRetry').hidden = false;
      }).finally(() => { busy = false; updateActions(); });
      return queue;
    }
    async function sync(pending) {
      connected = false; $('quakePushTest').disabled = true;
      if (pending) {
        const result = await pending; subscriptionTask = null;
        if (result.error) {
          if (result.error.name === 'NotAllowedError') {
            prefs.quakeNotifyEnabled = $('quakeNotifyEnabled').checked = false; persist();
            throw Error('Notifications were not allowed. Check this app’s notification permission in device settings, then enable notifications again.');
          }
          throw result.error;
        }
        subscription = result.subscription;
      }
      if (!registration) return;
      subscription = await registration.pushManager.getSubscription();
      if (!prefs.quakeNotifyEnabled) {
        if (subscription) {
          const existing = subscription;
          let serverError;
          try { await request('/unsubscribe', {subscription:existing.toJSON()}); } catch (error) { serverError = error; }
          await existing.unsubscribe(); subscription = null;
          if (serverError) throw Error('Notifications are off on this device. Retry connection to check the service.');
        }
        $('quakePushRetry').hidden = true;
        status('Notifications are off. Turn on Enable notifications to send a test.'); return;
      }
      if (!subscription) {
        $('quakePushRetry').hidden = false;
        status('Tap Retry connection to finish enabling notifications on this device.'); return;
      }
      status('Saving notification preferences…');
      await request('/subscribe', {subscription:subscription.toJSON(), preferences:{...prefs}});
      connected = true; $('quakePushRetry').hidden = true;
      status('Notifications are on. Your alert preferences are saved for this device.');
    }
    async function prepare() {
      const reason = unsupported();
      if (reason) { status(reason); return; }
      status('Connecting notification service…');
      // The original Gregle address shares a root worker with other apps. Give
      // this page a more specific registration and use that exact registration.
      const registered = await navigator.serviceWorker.register('/earthquakes-sw.js', {scope:sharedOrigin ? '/earthquakes' : '/', updateViaCache:'none'});
      const worker = registered.active || registered.installing || registered.waiting;
      if (!worker) throw Error('Notification setup could not start. Retry connection.');
      if (worker.state !== 'activated') {
        await new Promise((resolve, reject) => {
          const finish = error => { clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
          const changed = () => {
            if (worker.state === 'activated') finish();
            else if (worker.state === 'redundant') finish(Error('Notification setup failed. Retry connection.'));
          };
          const timer = setTimeout(() => finish(Error('Notification setup timed out. Retry connection.')), 20000);
          worker.addEventListener('statechange', changed);
          changed();
        });
      }
      registration = registered;
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
    $('quakePushEnable').addEventListener('click', enable);
    $('quakePushRetry').addEventListener('click', () => {
      if (busy) return;
      if (!publicKey || !registration) return enqueue(prepare);
      // Retrying a missing subscription is also a fresh user gesture on iPhone.
      const pending = prefs.quakeNotifyEnabled && !subscription ? beginSubscription() : undefined;
      enqueue(() => sync(pending));
    });
    $('quakePushTest').addEventListener('click', () => enqueue(async () => {
      if (!subscription || !connected) return;
      $('quakePushTest').disabled = true;
      try {
        await request('/test', {subscription:subscription.toJSON()});
        status('Test notification sent. Check this device’s notifications.');
      } catch (error) {
        if (error.status === 404 || error.status === 410) {
          if (error.status === 410) { await subscription.unsubscribe(); subscription = null; }
          connected = false; $('quakePushRetry').hidden = false;
          status('This notification subscription needs reconnecting. Tap Retry connection.');
        } else {
          // A delivery failure does not invalidate the saved subscription or preferences.
          status('The test notification could not be delivered. Your connection is still saved. Try Send test notification again.');
        }
      }
    }));
    window.addEventListener('online', () => enqueue(() => publicKey && registration ? sync() : prepare()));
    updateActions(); enqueue(prepare);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();

