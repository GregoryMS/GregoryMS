/* Weather keeps the shared root registration, without caching live forecasts. */
'use strict';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch (_) {}
  let url;
  try { url = new URL(message.url || '/', self.location.origin); } catch (_) { url = new URL('/', self.location.origin); }
  event.waitUntil(self.registration.showNotification(message.title || 'Gregle Weather', {
    body: message.body || 'Open Weather for your latest forecast.',
    icon: '/assets/weather-app/icon-192.png', badge: '/assets/weather-app/icon-192.png',
    tag: message.tag || 'gregle-weather',
    data: {url: url.origin === self.location.origin ? url.href : self.location.origin + '/'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || self.location.origin + '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
