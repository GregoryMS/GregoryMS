/* Calculator-only offline cache. ROMs and user data stay in IndexedDB/localStorage. */
'use strict';
const VERSION='20261118-offline-refresh1';
const PREFIX='gregle-calculator-';
const refresh=self.location.hostname==='calc.gregle.uk' ? new URL(self.location.href).searchParams.get('calc-refresh') : '';
const CACHE=PREFIX+VERSION+(/^[a-z0-9-]{1,40}$/.test(refresh || '') ? '-refresh-'+refresh : '');
const DOCUMENT='/calc.html';
const ASSETS=[
  '/calc.webmanifest',
  '/assets/installed-app.css?v=20261002-radio',
  '/assets/tools.css',
  '/assets/fonts/gregle-wordmark-300.woff?v=20261102-heading1',
  '/assets/calc.css?v=20261102-heading1',
  '/assets/calc-graph.css?v=20261101-dpad-restored1',
  '/assets/calc-emulator.css?v=20261117-pointer1',
  '/assets/site-menu.css?v=20261117-app-theme2',
  '/assets/preferences.js?v=20261113-shared-device1',
  '/assets/theme.js?v=20261113-shared-device1',
  '/assets/site-menu.js?v=20261117-app-theme2',
  '/assets/calc-scientific.css?v=20261118-offline-refresh1',
  '/assets/calc-viewport.js?v=20261118-offline-refresh1',
  '/assets/calc-haptics.js?v=20261117-haptics1',
  '/assets/calc-picker.js?v=20261117-pointer1',
  '/assets/calc-scientific.js?v=20261118-menu-focus1',
  '/assets/calc-formula-math.js?v=20261118-offline-refresh1',
  '/assets/calc-formulas.js?v=20261118-offline-refresh1',
  '/assets/calc-core.js?v=20261117-fractions1',
  '/assets/calc.js?v=20261118-offline-refresh1',
  '/assets/calc-graph-core.js?v=20261029-graph',
  '/assets/calc-graph.js?v=20261031-clean-labels',
  '/assets/calc-emulator.js?v=20261117-visible1',
  '/assets/calc-offline.js?v=20261118-offline-refresh1',
  '/assets/calc-ti89.js?v=20261102-ti89-6',
  '/assets/calc-tinspire.js?v=20261115-nspire2',
  '/assets/tinspire/worker.mjs',
  '/assets/tinspire/firebird.mjs',
  '/assets/tinspire/firebird.wasm',
  '/assets/tinspire/firmware.mjs',
  '/assets/tinspire/rom-source.mjs',
  '/assets/tinspire/README.md',
  '/assets/tinspire/COPYING.txt',
  '/assets/ti89/worker.js',
  '/assets/ti89/ti68k.js',
  '/assets/ti89/rom-source.mjs?v=20261102-ti89-6',
  '/assets/ti89/README.md',
  '/assets/ti89/COPYING.txt',
  '/assets/ti84/worker.mjs',
  '/assets/ti84/cemu.mjs',
  '/assets/ti84/cemu.wasm',
  '/assets/ti84/rom-source.mjs?v=20261031-hosted1',
  '/assets/ti84/README.md',
  '/assets/ti84/LICENSE-CEmu.txt',
  '/assets/ti84/COPYING.txt',
  '/assets/calc-app/apple-touch-icon.png',
  '/assets/calc-app/icon-192.png',
  '/assets/calc-app/icon-512.png',
  '/assets/calc-app/favicon.ico',
  '/assets/calc-app/favicon-32.png',
  '/assets/calc-app/icon.svg'
];
const assetURLs=new Set(ASSETS.map(path => new URL(path,self.location.origin).href));
function calculatorDocument(url) {
  return url.pathname===DOCUMENT || (url.hostname==='calc.gregle.uk' && url.pathname==='/');
}
self.addEventListener('install',event => {
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE);
    // Fetch every dependency before this version can activate. A failed update
    // leaves the previous complete calculator available, including offline.
    const files=[DOCUMENT,...ASSETS];
    const results=await Promise.allSettled(files.map(async path => {
      const source=path===DOCUMENT && self.location.hostname==='calc.gregle.uk' ? '/' : path;
      const response=await fetch(new Request(new URL(source,self.location.origin),{cache:'reload',credentials:'same-origin'}));
      if (!response.ok || new URL(response.url).origin!==self.location.origin) throw new Error('Incomplete offline download: '+path);
      const type=response.headers.get('content-type') || '';
      if ((/\.(?:m?js)(?:\?|$)/.test(path) && !/(?:java|ecma)script/i.test(type)) ||
          (/\.wasm$/.test(path) && !type.includes('application/wasm')) ||
          (path===DOCUMENT && !type.includes('text/html'))) throw new Error('Unexpected offline file: '+path);
      if (path===DOCUMENT) {
        const html=await response.clone().text();
        for (const [tag,reference] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g)) {
          if (tag.startsWith('<link') && !/rel="(?:stylesheet|manifest|icon|apple-touch-icon)"/.test(tag)) continue;
          const dependency=new URL(reference,self.location.origin);
          if (dependency.origin!==self.location.origin || !assetURLs.has(dependency.href)) throw new Error('Calculator files are still updating.');
        }
      }
      await cache.put(new URL(path,self.location.origin),response);
    }));
    if (results.some(result => result.status==='rejected')) {
      await caches.delete(CACHE);
      throw new Error('Calculator offline setup could not finish.');
    }
    // A fully cached release can serve the next launch even if iOS kept an old
    // calculator window alive. Leave the shared Gregle worker's lifecycle alone.
    if (self.location.hostname==='calc.gregle.uk') await self.skipWaiting();
  })());
});
self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    const names=await caches.keys();
    if (!self.registration?.installing && !self.registration?.waiting) {
      for (const name of names) if (name.startsWith(PREFIX) && name!==CACHE) await caches.delete(name);
    }
    // No clients.claim: unrelated Gregle pages keep their normal behaviour.
  })());
});
self.addEventListener('fetch',event => {
  const request=event.request, url=new URL(request.url);
  if (request.method!=='GET' || url.origin!==self.location.origin) return;
  const navigation=request.mode==='navigate' && calculatorDocument(url);
  if (!navigation && !assetURLs.has(url.href)) return;
  event.respondWith((async () => {
    const cache=await caches.open(CACHE);
    return await cache.match(navigation ? new URL(DOCUMENT,self.location.origin) : request) || fetch(request);
  })());
});
self.addEventListener('message',event => {
  if (event.data?.type!=='calculator-offline-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE);
    const ready=(await Promise.all([DOCUMENT,...ASSETS].map(path => cache.match(new URL(path,self.location.origin))))).every(Boolean);
    event.ports[0].postMessage({ready,version:VERSION});
  })());
});
