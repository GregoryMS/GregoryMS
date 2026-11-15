/* Offline downloads and local routing. No tile provider is prefetched. */
(() => {
  'use strict';
  const store=window.GregleOfflineStore;
  const api=['localhost','127.0.0.1'].includes(location.hostname)?'/api/maps/offline/':'https://maps.gregle.uk/api/maps/offline/';
  let forced=false,worker,requestId=0,pending=new Map(),installed=[],registration;
  try{forced=localStorage.getItem('gregle-maps-use-offline')==='on';}catch{}
  const active=()=>forced||navigator.onLine===false;
  const changed=()=>window.dispatchEvent(new Event('gregle-offline-change'));
  const reload=async()=>{installed=await store.list();changed();return installed;};
  const supported=()=>window.isSecureContext&&'indexedDB' in window&&'DecompressionStream' in window&&'serviceWorker' in navigator;
  async function route(from,to,mode,{signal}={}) {
    signal?.throwIfAborted();
    if(!worker){worker=new Worker('/assets/maps-offline-worker.js');worker.onmessage=event=>{const job=pending.get(event.data.id);if(!job)return;pending.delete(event.data.id);job.cleanup();event.data.error?job.reject(Error(event.data.error)):job.resolve(event.data.result);};worker.onerror=()=>{for(const job of pending.values()){job.cleanup();job.reject(Error('The offline routing engine could not load. Reopen Maps and try again.'));}pending.clear();worker.terminate();worker=null;};}
    // A newer request supersedes a pending route/traffic refresh.
    for(const job of pending.values()){job.cleanup();job.reject(new DOMException('Aborted','AbortError'));}pending.clear();
    const id=++requestId;
    return new Promise((resolve,reject)=>{
      const abort=()=>{if(!pending.has(id))return;pending.delete(id);worker?.postMessage({cancel:true});cleanup();reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
      worker.postMessage({id,from,to,mode});
    });
  }
  window.GregleOfflineMaps={active,route,supported,get installed(){return installed;},setEnabled(value){forced=!!value;try{localStorage.setItem('gregle-maps-use-offline',forced?'on':'off');}catch{}changed();}};
  window.addEventListener('online',changed);window.addEventListener('offline',changed);
  // Downloaded street/place names are a small local search index. Coordinates,
  // map pins and saved Home/Work locations also remain usable offline.
  window.GregleOfflineMaps.search=async(term,center)=>{
    const matches=[],seen=new Set(),query=term.trim().toLocaleLowerCase();
    const pack=installed.filter(p=>p.component==='maps').sort((a,b)=>Number(store.inside(center,b.bounds))-Number(store.inside(center,a.bounds))||a.blob.size-b.blob.size)[0];
    if(!pack)return [];
    let keys=Object.keys(pack.index.entries),local=store.tile(center.lat,center.lng);
    keys=keys.sort((a,b)=>Number(b===local)-Number(a===local));
    // Overview contains town names and major roads; local cells add street names.
    keys=['overview',...keys.filter(k=>k!=='overview'&&Math.abs(Number(k.split('_')[0])-Math.floor(center.lng*4))<=1&&Math.abs(Number(k.split('_')[1])-Math.floor(center.lat*4))<=1)];
    for(const key of keys){for(const [kind,name,geometry] of await store.read(pack,key)||[]){
      if(!name||!name.toLocaleLowerCase().includes(query)||seen.has(name))continue;
      const p=kind==='place'?geometry:geometry[Math.floor(geometry.length/2)];if(!store.inside({lat:p[0],lng:p[1]},pack.bounds))continue;
      seen.add(name);matches.push({lat:p[0],lng:p[1],name,detail:`Downloaded ${pack.name} · ${kind==='place'?'place':'road'}`,zoom:kind==='place'?13:16});
    }if(matches.length>=30)break;}
    return matches.sort((a,b)=>window.GregleNavigation.meters(a,center)-window.GregleNavigation.meters(b,center)).slice(0,8);
  };
  window.GregleOfflineMaps.attach=async({map,layers,drawer,notify})=>{
    const $=id=>document.getElementById(id),panel=$('map-offline-panel'),button=$('map-offline-toggle'),status=$('offline-status');
    const credit='Offline data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>';
    let catalog,download,drawVersion=0,vector=L.layerGroup(),footprint=L.layerGroup(),lastMode=false;
    map.createPane('offlineBackground',map.getPane('overlayPane').parentNode).style.zIndex='210';
    const renderer=L.canvas({padding:.2});
    const cache=new Map();
    const message=text=>{status.textContent=text;};
    const size=bytes=>bytes<1048576?`${(bytes/1024).toFixed(0)} KB`:`${(bytes/1048576).toFixed(1)} MB`;
    const open=()=>{document.getElementById('close-map-base').click();panel.hidden=false;button.setAttribute('aria-expanded','true');drawer?.show('map-offline-panel',true);loadCatalog();};
    button.addEventListener('click',()=>{if(panel.hidden||panel.inert)open();else close();});
    function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');document.getElementById('map-base-toggle').focus({preventScroll:true});}
    $('close-map-offline').addEventListener('click',close);
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
    $('offline-use').addEventListener('change',()=>window.GregleOfflineMaps.setEnabled($('offline-use').checked));
    $('offline-cancel').addEventListener('click',()=>download?.abort());
    $('offline-refresh').addEventListener('click',()=>loadCatalog(true));
    let loading;
    async function loadCatalog(refresh=false){
      if(loading)return loading;
      if(catalog&&!refresh)return;
      loading=(async()=>{try{
        if(!navigator.onLine){message('Offline. Saved regions are available below.');return;}
        message('Checking downloadable regions…');
        const response=await fetch(api+'catalog.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw Error('Regional downloads are being prepared. Try Check for updates shortly.');
        catalog=store.catalog(await response.json());message('Choose maps, routing, or both. Downloads stay on this device.');
      }catch(e){message(e.message||'Could not check downloads. Your saved regions are still available.');}finally{loading=null;render();}})();
      return loading;
    }
    function render(){
      $('offline-use').checked=forced;
      const list=$('offline-regions');list.replaceChildren();
      for(const [id,name] of store.presets){
        const item=document.createElement('section'),heading=document.createElement('h3');heading.textContent=name;item.append(heading);
        for(const component of ['maps','routing']){
          const saved=installed.find(p=>p.region===id&&p.component===component),region=catalog?.regions.find(r=>r.id===id),part=region?.components[component];
          const row=document.createElement('div'),label=document.createElement('span'),action=document.createElement('button');row.className='offline-package';
          label.textContent=`${component==='maps'?'Street map':'Route navigation'}${part?' · '+size(part.bytes):''}${saved?' · Saved '+size(saved.blob.size):''}`;
          action.type='button';action.textContent=saved?(catalog&&saved.version!==catalog.version?'Update':'Downloaded'):'Download';action.disabled=!!download||!part||!!saved&&saved.version===catalog?.version||!supported();
          action.setAttribute('aria-label',`${action.textContent} ${name} ${component}`);action.addEventListener('click',()=>install(region,component));row.append(label,action);
          if(saved&&component==='maps'){const view=document.createElement('button');view.type='button';view.textContent='View';view.setAttribute('aria-label',`View downloaded ${name} map`);view.addEventListener('click',()=>{window.GregleOfflineMaps.setEnabled(true);map.fitBounds([[saved.bounds[1],saved.bounds[0]],[saved.bounds[3],saved.bounds[2]]]);close();});row.append(view);}
          if(saved){const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.disabled=!!download;remove.setAttribute('aria-label',`Remove ${name} ${component}`);remove.addEventListener('click',async()=>{try{await store.remove(saved.key);cache.clear();await reload();message(`${name} ${component} removed.`);}catch(e){message(e.message);}});row.append(remove);}
          item.append(row);
        }
        list.append(item);
      }
      $('offline-cancel').hidden=!download;
      $('offline-refresh').disabled=!!download;
      if(navigator.storage?.estimate)navigator.storage.estimate().then(value=>{$('offline-storage').textContent=value.quota?`${size(value.usage||0)} used of approximately ${size(value.quota)} browser storage.`:'Storage availability depends on your browser.';}).catch(()=>{});
    }
    async function install(region,component){
      if(download)return;download=new AbortController();const controller=download,version=catalog.version,index=region.components[component];
      $('offline-progress').hidden=false;$('offline-progress').value=0;render();
      try{
        const estimate=await navigator.storage?.estimate?.();
        if(estimate?.quota&&estimate.quota-estimate.usage<index.bytes*1.15)throw Error('Not enough free browser storage. Remove a saved region or free some space first.');
        const persistent=await navigator.storage?.persist?.();
        message(`Downloading ${region.name} ${component}… Keep Maps open.`);
        const response=await fetch(`${api}${version}/${index.file}`,{signal:controller.signal,cache:'no-store',credentials:'omit'});
        if(!response.ok||!response.body)throw Error('Download unavailable. Your previous download is unchanged.');
        let received=0;const reader=response.body.getReader();
        const stream=new ReadableStream({async pull(target){try{const {done,value}=await reader.read();if(done){target.close();return;}received+=value.byteLength;if(received>index.bytes){await reader.cancel();throw Error('Unexpected download size.');}$('offline-progress').value=received/index.bytes*.8;target.enqueue(value);}catch(e){target.error(e);}},cancel:()=>reader.cancel()});
        const blob=await new Response(stream).blob();
        message('Checking the download…');await store.verify(blob,index,controller.signal,f=>{$('offline-progress').value=.8+f*.2;});
        controller.signal.throwIfAborted();
        // One transaction replaces the old package only after every member was
        // verified; cancellation, quota errors and failed updates keep it intact.
        const key=`${region.id}-${component}`;
        await store.put(key,{key,region:region.id,name:region.name,bounds:region.bounds,component,version,index,blob,savedAt:Date.now()});
        cache.clear();await reload();
        message(`${region.name} ${component} saved.${persistent?'':' Your browser may remove downloads when storage is low.'} Use downloaded maps to try it now.`);
      }catch(e){message(e.name==='AbortError'?'Download cancelled. Previous downloads are still available.':e.name==='QuotaExceededError'?'Browser storage is full. Remove a saved region and try again.':e.message);}
      finally{download=null;$('offline-progress').hidden=true;render();}
    }
    async function features(pack,key){const id=pack.key+pack.version+key;if(cache.has(id))return cache.get(id);const data=await store.read(pack,key)||[];cache.set(id,data);while(cache.size>16)cache.delete(cache.keys().next().value);return data;}
    async function draw(){
      const token=++drawVersion;vector.clearLayers();footprint.clearLayers();
      const packs=installed.filter(p=>p.component==='maps'),bounds=map.getBounds(),center=map.getCenter();
      const selected=packs.filter(p=>store.inside(center,p.bounds)).sort((a,b)=>a.blob.size-b.blob.size)[0]||packs.find(p=>bounds.intersects([[p.bounds[1],p.bounds[0]],[p.bounds[3],p.bounds[2]]]));
      if(!active())return;
      $('offline-connection').textContent=selected?`Offline maps · ${selected.name} · live layers unavailable`:'No downloaded map here · choose Offline maps to view or save a region';
      if(!selected)return;
      try{
        const b=selected.bounds;
        L.rectangle([[b[1],b[0]],[b[3],b[2]]],{pane:'offlineBackground',color:'#7637cc',weight:1,fillColor:'#f1f0e9',fillOpacity:1,interactive:false}).addTo(footprint);
        const keys=['overview'],x1=Math.max(Math.floor(bounds.getWest()*4),Math.floor(b[0]*4)),x2=Math.min(Math.floor(bounds.getEast()*4),Math.floor(b[2]*4)),y1=Math.max(Math.floor(bounds.getSouth()*4),Math.floor(b[1]*4)),y2=Math.min(Math.floor(bounds.getNorth()*4),Math.floor(b[3]*4));
        if(map.getZoom()>=10&&(x2-x1+1)*(y2-y1+1)<=16)for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++)keys.push(`${x}_${y}`);
        const labelCandidates=[];
        for(const key of keys){const data=await features(selected,key);if(token!==drawVersion)return;
          const geojson=[];
          for(const [kind,name,coords,polygon] of data){
            if(key==='overview'&&keys.length>1&&kind!=='place')continue;
            if(kind==='place'){if(name&&bounds.contains(coords))labelCandidates.push({p:coords,name,place:true});continue;}
            if(!polygon&&map.getZoom()<13&&!['motorway','trunk','primary','secondary','ferry','water','coastline','river'].includes(kind))continue;
            geojson.push({type:'Feature',properties:{kind,name,polygon},geometry:{type:polygon?'Polygon':'LineString',coordinates:polygon?[coords.map(p=>[p[1],p[0]])]:coords.map(p=>[p[1],p[0]])}});
          }
          L.geoJSON({type:'FeatureCollection',features:geojson},{renderer,interactive:false,style:f=>{
            const {kind,polygon}=f.properties,water=['water','coastline','river','stream','riverbank'].includes(kind),park=kind==='park',major=['motorway','trunk','primary'].includes(kind);
            return {color:water?'#90bfd0':park?'#bad3a6':major?'#dfba76':'#c5c0b7',weight:polygon?1:major?4:2,fillColor:water?'#b8dce6':'#d6e3c9',fillOpacity:polygon?.85:0,dashArray:['footway','path','steps','ferry'].includes(kind)?'3 5':null};
          }}).addTo(vector);
          if(map.getZoom()>=15)for(const [kind,name,coords,polygon] of data){if(!name||kind==='place'||polygon)continue;const p=coords[Math.floor(coords.length/2)];if(bounds.contains(p))labelCandidates.push({p,name,place:false});}
        }
        // Label a street once near the centre, keeping clear of other names.
        const occupied=[],names=new Set(),size=map.getSize();
        for(const candidate of labelCandidates){candidate.screen=map.latLngToContainerPoint(candidate.p);candidate.distance=Math.hypot(candidate.screen.x-size.x/2,candidate.screen.y-size.y/2);}
        labelCandidates.sort((a,b)=>Number(b.place)-Number(a.place)||a.distance-b.distance);
        for(const {p,name,place,screen} of labelCandidates){
          if(names.has(name)||names.size>=80)continue;
          const box={left:screen.x-10,right:screen.x+Math.min(180,name.length*6.3)+10,top:screen.y-10,bottom:screen.y+(place?18:14)};
          if(occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top))continue;
          names.add(name);occupied.push(box);
          const el=document.createElement('span');el.textContent=name;
          L.marker(p,{icon:L.divIcon({className:place?'offline-place-label':'offline-road-label',html:el}),interactive:false}).addTo(vector);
        }
      }catch(e){if(token===drawVersion)notify('The downloaded map could not be read. Remove and download this region again.');}
    }
    function sync(){
      const offline=active();document.querySelector('.map-stage').classList.toggle('offline-maps-active',offline);
      $('offline-connection').hidden=!offline;$('offline-connection').textContent=offline?'Offline maps · live layers unavailable':'';
      $('offline-use').checked=forced;button.dataset.saved=String(installed.length>0);
      if(offline){if(!map.hasLayer(footprint))footprint.addTo(map);if(!map.hasLayer(vector))vector.addTo(map);map.attributionControl?.addAttribution(credit);}
      else{map.removeLayer(vector);map.removeLayer(footprint);map.attributionControl?.removeAttribution(credit);}
      if(offline!==lastMode){lastMode=offline;layers.setState(layers.getState());}
      draw();render();
    }
    window.addEventListener('gregle-offline-change',sync);map.on('moveend',draw);
    if(!supported()){message('Offline downloads need a secure browser with IndexedDB, service workers and gzip support.');render();return;}
    try{
      await reload();
      registration=await navigator.serviceWorker.register('/gregle-sw.js?v=20261115-offline1',{scope:'/',updateViaCache:'none'});
      const ready=await navigator.serviceWorker.ready;
      const channel=new MessageChannel();
      channel.port1.onmessage=event=>{if(event.data.ready)$('offline-shell-status').textContent='Maps is saved for offline opening. Close and reopen Maps after an app update.';};
      ready.active?.postMessage({type:'maps-offline-status'},[channel.port2]);
      if(registration.waiting)$('offline-shell-status').textContent='An app update is ready. Close all Maps tabs and reopen to finish.';
      sync();
    }catch(e){message('Offline setup could not finish: '+e.message);}
  };
})();
