/* Imported by the shared Gregle worker; region archives live in IndexedDB. */
(() => {
  'use strict';
  importScripts('/assets/maps-offline-shell.js');
  const {version,assets}=self.GregleMapsShell,prefix='gregle-maps-shell-',name=prefix+version,documentURL='/maps.html';
  const allowed=new Set(assets.map(p=>new URL(p,self.location.origin).href));
  self.addEventListener('install',event=>event.waitUntil((async()=>{
    const cache=await caches.open(name);
    try{
      const response=await fetch(self.location.hostname==='maps.gregle.uk'?'/':documentURL,{cache:'reload'});
      if(!response.ok||new URL(response.url).origin!==self.location.origin||!response.headers.get('content-type')?.includes('text/html'))throw Error('Maps shell is unavailable.');
      const html=await response.clone().text();
      for(const [tag,ref] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g)){
        if(tag.startsWith('<link')&&!/rel="(?:stylesheet|manifest|icon|apple-touch-icon)"/.test(tag))continue;
        if(ref.startsWith('https://fonts.googleapis.com/'))continue;
        if(!allowed.has(new URL(ref,self.location.origin).href))throw Error('Maps files are still updating.');
      }
      await cache.put(documentURL,response);
      // Keep the number of parallel fetches small on mobile connections.
      for(let i=0;i<assets.length;i+=6){
        const results=await Promise.allSettled(assets.slice(i,i+6).map(async p=>{
          const response=await fetch(p,{cache:'reload'}),type=response.headers.get('content-type')||'';
          if(!response.ok||new URL(response.url).origin!==self.location.origin||/\.js(?:\?|$)/.test(p)&&!/(?:java|ecma)script/.test(type)||/\.css(?:\?|$)/.test(p)&&!type.includes('text/css'))throw Error('Incomplete Maps shell: '+p);
          await cache.put(p,response);
        }));
        if(results.some(r=>r.status==='rejected'))throw Error('Incomplete Maps shell.');
      }
    }catch(error){await caches.delete(name);throw error;}
    // Wait for running maps/navigation sessions to close before upgrading.
  })()));
  self.addEventListener('activate',event=>event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==name)await caches.delete(key);
  })()));
  self.addEventListener('fetch',event=>{
    const request=event.request,url=new URL(request.url);
    if(request.method!=='GET'||url.origin!==self.location.origin)return;
    const navigation=request.mode==='navigate'&&(['/maps.html','/maps'].includes(url.pathname)||url.pathname==='/'&&url.hostname==='maps.gregle.uk');
    // Calculator and Maps share a few dependencies on the apex. The calculator
    // listener owns those requests; two respondWith calls would be invalid.
    if(!navigation&&!allowed.has(url.href)&&!assets.some(p=>new URL(p,self.location.origin).pathname===url.pathname))return;
    if(self.location.hostname!=='maps.gregle.uk'&&typeof assetURLs!=='undefined'&&assetURLs.has(url.href))return;
    event.respondWith((async()=>{const cache=await caches.open(name);return await cache.match(navigation?documentURL:request,{ignoreSearch:!navigation})||fetch(request);})());
  });
  self.addEventListener('message',event=>{
    if(event.data?.type!=='maps-offline-status'||!event.ports[0])return;
    event.waitUntil((async()=>{const cache=await caches.open(name);const ready=!!await cache.match(documentURL)&&(await cache.keys()).length>=assets.length+1;event.ports[0].postMessage({ready,version});})());
  });
})();
