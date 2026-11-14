(() => {
  'use strict';
  window.GregleTransitNetwork = ({map,enableTransit,onStop,onRoute}) => {
    const core=window.GregleTransitNetworkCore, $=id=>document.getElementById(id);
    const panel=$('transit-browser'), button=$('transit-browser-toggle'), search=$('transit-route-search'), cityInput=$('transit-city'), results=$('transit-route-results'), status=$('transit-browser-status');
    const overview=L.layerGroup(), cache=new Map(), routes=new Map(),pending=new Map(),indexControllers=new Set();
    let enabled=false,controller,version=0,city,networks=[],systems,manifestTask,manifestController,selected=false,menuVersion=0,lineCity,routeController;
    const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
    const regionName=id=>systems?.find(s=>s.city===id)?.name||(id==='vancouver'?'Vancouver':'Victoria');
    async function loadSystems(){
      if(systems)return systems;if(manifestTask)return manifestTask;
      manifestController=new AbortController();
      manifestTask=(async()=>{try{systems=core.readRegions(await json('data/transit/regions.json',manifestController.signal));const previous=cityInput.value;cityInput.replaceChildren();for(const name of new Set(systems.map(s=>s.group))){const group=make('optgroup');group.label=name;for(const area of systems.filter(s=>s.group===name)){const option=make('option',area.name);option.value=area.city;group.append(option);}cityInput.append(group);}cityInput.value=systems.some(s=>s.city===previous)?previous:'victoria';return systems;}finally{manifestTask=null;}})();return manifestTask;
    }
    async function json(url,signal) {
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),credentials:'omit'});
      if(!response.ok)throw Error('Transit map unavailable');
      const body=await response.text();if(body.length>8000000)throw Error('Transit map too large');return JSON.parse(body);
    }
    async function getIndex(id,signal) {
      if(cache.has(id))return cache.get(id);
      if(pending.has(id))return pending.get(id);
      const own=new AbortController();indexControllers.add(own);const request=(async()=>{try{const data=core.readIndex(await json(`data/transit/${id}/index.json`,own.signal),id);cache.set(id,data);return data;}finally{pending.delete(id);indexControllers.delete(own);}})();pending.set(id,request);return request;
    }
    function close() {panel.hidden=true;button.setAttribute('aria-expanded','false');menuVersion++;}
    function routeButton(route,data) {
      const item=make('li'),action=make('button',null,'transit-menu-route');action.type='button';
      const number=make('strong',route.number,'transit-number');number.style.setProperty('--route-color',route.color);
      const copy=make('span'),name=make('span',route.name),kind=make('small',route.mode==='BUS'?route.rapid?'RapidBus':'Bus':route.mode==='FERRY'?'Passenger ferry':route.mode==='SUBWAY'?'SkyTrain':'Commuter rail');
      copy.append(name,kind);action.append(number,copy);action.addEventListener('click',()=>select(route,data));item.append(action);return item;
    }
    function renderMenu(data) {
      results.replaceChildren();const found=core.search(data,search.value);
      for(const route of found.routes.slice(0,100))results.append(routeButton(route,data));
      if(found.routes.length>100)results.append(make('li','Type a route number or destination to narrow the list.','transit-meta'));
      if(found.stops.length){const heading=make('li','Stops & stations','transit-menu-heading');results.append(heading);}
      for(const stop of found.stops) {
        const li=make('li'),action=make('button',stop.name,'transit-menu-station');action.type='button';
        if(stop.code)action.append(make('small',`Stop ${stop.code}`));
        action.addEventListener('click',()=>{close();map.setView([stop.lat,stop.lng],17);onStop(stop);});li.append(action);results.append(li);
      }
      const age=Date.now()-Date.parse(data.updated+'T12:00:00-08:00');
      status.textContent=`${regionName(data.city)} · ${found.routes.length} route${found.routes.length===1?'':'s'}${search.value.trim()?` · ${found.stops.length} stops / stations`:''} · map updated ${data.updated}${age>14*86400000?' · older map: check operator for changes':''}.`;
      if(!found.routes.length&&!found.stops.length)results.append(make('li','No matches. Try a route number, destination or station name.','transit-meta'));
      $('transit-data-credit').textContent=data.city==='vancouver'?'Route and arrival data used in this product or service is provided by permission of TransLink. TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.':'Contains information distributed by BC Transit. Published route map; check departures for current service.';
    }
    async function loadMenu() {
      const token=++menuVersion;status.textContent='Loading routes…';results.replaceChildren();
      try {await loadSystems();const data=await getIndex(cityInput.value,controller?.signal||new AbortController().signal);if(token!==menuVersion||panel.hidden)return;renderMenu(data);}
      catch(error){if(token===menuVersion){status.textContent='Route menu could not load. Use Retry routes to try again.';}}
    }
    async function open() {
      enableTransit();panel.hidden=false;button.setAttribute('aria-expanded','true');
      panel.scrollTop=0;await loadSystems().catch(()=>{});const p=map.getCenter();cityInput.value=core.cityAt(p.lat,window.GregleMaps.wrapLongitude(p.lng),systems)||cityInput.value||'victoria';
      await loadMenu();if(!panel.hidden)search.focus({preventScroll:true});
    }
    async function select(route,data) {
      routeController?.abort();const request=new AbortController();routeController=request;
      status.textContent=`Loading route ${route.number}…`;
      try {
        const key=`${data.city}/${route.file}`;
        let detail=routes.get(key);
        if(!detail){detail=core.readRoute(await json(`data/transit/${key}`,request.signal));if(detail.id!==route.id||detail.routeId!==route.routeId)throw Error('Route mismatch');routes.set(key,detail);while(routes.size>12)routes.delete(routes.keys().next().value);}
        if(request.signal.aborted||!enabled||document.hidden)return;
        close();onRoute(detail,data.stops);status.textContent=`Route ${route.number} selected.`;
      } catch(error) {if(!request.signal.aborted)status.textContent=`Route ${route.number} could not load. Select it again to retry.`;}
      finally{if(routeController===request)routeController=null;}
    }
    function drawOverview(dataList) {
      const key=dataList.map(d=>d.city).join(',');if(lineCity===key)return;
      overview.clearLayers();lineCity=key;
      for(const data of dataList)for(const route of data.rapid) {
        const paths=route.variants.map(v=>v.points),label=make('span',route.number===route.name?route.name:`${route.number} · ${route.name}`);
        L.polyline(paths,{color:'#fff',weight:7,opacity:.9,interactive:false,className:'transit-network-line'}).addTo(overview);
        L.polyline(paths,{color:route.color,weight:4,opacity:.9,bubblingMouseEvents:false,className:'transit-network-line'}).bindTooltip(label,{sticky:true}).on('click',()=>select(route,data)).addTo(overview);
      }
    }
    async function refresh() {
      if(!enabled||document.hidden)return;
      const token=++version;
      try {
        await loadSystems();if(token!==version||!enabled||document.hidden)return;
        const b=map.getBounds(),wrap=window.GregleMaps.wrapLongitude,width=b.getEast()-b.getWest(),west=wrap(b.getWest());
        const wanted=width>=360?systems:core.inView([west,b.getSouth(),west+width,b.getNorth()],systems);
        const key=wanted.map(s=>s.city).join(',');
        if(city===key&&networks.length)return;
        city=key;networks=[];overview.clearLayers();lineCity=null;
        if(!wanted.length)return;
        const results=await Promise.allSettled(wanted.map(s=>getIndex(s.city)));
        if(token!==version||!enabled||document.hidden)return;
        networks=results.filter(r=>r.status==='fulfilled').map(r=>r.value);drawOverview(networks);
        map.fire(networks.length?'transitnetworkready':'transitnetworkerror');
      } catch(error){if(token===version)map.fire('transitnetworkerror');}
    }
    button.addEventListener('click',()=>panel.hidden?open():close());
    $('close-transit-browser').addEventListener('click',()=>{close();button.focus();});
    $('transit-routes-retry').addEventListener('click',()=>{loadMenu();refresh();});
    cityInput.addEventListener('change',()=>{routeController?.abort();search.value='';loadMenu();});
    search.addEventListener('input',loadMenu);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close();button.focus();}});
    map.on('moveend',refresh);
    map.on('transitroutechange',event=>{selected=event.active;map.getContainer().classList.toggle('transit-network-selected',selected);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){version++;controller?.abort();routeController?.abort();city=null;networks=[];manifestController?.abort();for(const c of indexControllers)c.abort();}else if(enabled)refresh();});
    return {
      setEnabled(value){if(enabled===value)return;enabled=value;if(value){overview.addTo(map);refresh();}else{version++;controller?.abort();routeController?.abort();overview.clearLayers();map.removeLayer(overview);lineCity=null;city=null;networks=[];manifestController?.abort();for(const c of indexControllers)c.abort();close();}},
      stops(){return networks.length?networks.flatMap(data=>data.stops):undefined;},
      async showDeparture(row,stop) {
        await loadSystems().catch(()=>{});const id=stop.system||core.cityAt(stop.lat,stop.lng,systems);if(!id)return false;
        try {
          const data=await getIndex(id,controller?.signal||new AbortController().signal);
          const route=data.routes.find(r=>r.routeId===row.routeId)||data.routes.find(r=>r.number.toLowerCase()===row.route.toLowerCase());
          if(!route)return false;await select(route,data);return true;
        }catch{return false;}
      }
    };
  };
})();
