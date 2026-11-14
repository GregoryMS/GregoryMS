(() => {
  'use strict';
  window.GregleTransitRoute=({map,requestJSON,canRequest,onStop})=>{
    const core=window.GregleTransitCore,group=L.layerGroup(),cache=new Map(),vehicles=window.GregleTransitVehicles?.({map});
    const panel=document.getElementById('transit-route-card'),title=document.getElementById('transit-route-title'),status=document.getElementById('transit-route-status'),detail=document.getElementById('transit-route-detail'),fit=document.getElementById('transit-route-fit'),retry=document.getElementById('transit-route-retry'),close=document.getElementById('transit-route-clear'),container=map.getContainer();
    const routeCredit='Route alignment: © <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © OpenStreetMap';
    let enabled=false,controller,version=0,route,selection,lastRequest=0,line,casing,networkRoute,networkStops;
    const direction=document.getElementById('transit-route-direction'),stopList=document.getElementById('transit-route-stops');
    function cancel(){version++;controller?.abort();controller=null;}
    function clear(){cancel();vehicles?.clear();group.clearLayers();map.attributionControl?.removeAttribution(routeCredit);route=null;selection=null;networkRoute=null;panel.hidden=true;container.classList.remove('transit-route-active');map.fire?.('transitroutechange',{active:false});}
    function fitRoute(){
      if(!route)return;const size=map.getSize(),mobile=size.x<=700;
      const stage=container.closest?.('.map-stage'),drawer=stage?.querySelector('.map-drawer:not([hidden])');
      const top=mobile?75:95;
      const bottom=drawer?Math.min(drawer.getBoundingClientRect().height+12,size.y-top-80):mobile?Math.min(panel.getBoundingClientRect?.().height+25||210,size.y*.45):35;
      map.fitBounds(L.latLngBounds(route.points),{paddingTopLeft:[mobile?16:Math.min(390,size.x*.32),top],paddingBottomRight:[mobile?70:100,Math.max(20,bottom)],maxZoom:16,animate:false});
    }
    function draw(data,fitView=true){
      route=data;group.clearLayers();
      casing=L.polyline(data.paths||data.points,{color:'#fff',weight:11,opacity:.98,interactive:false,smoothFactor:0}).addTo(group);
      line=L.polyline(data.paths||data.points,{color:data.color||'#7637cc',weight:6,opacity:1,interactive:false,smoothFactor:0}).addTo(group);
      const project=stop=>map.latLngToContainerPoint([stop.lat,stop.lng]),zoom=map.getZoom?.()||15;
      const stops=window.GregleTransitNetworkCore&&map.latLngToContainerPoint?window.GregleTransitNetworkCore.spaced([...data.stops].sort((a,b)=>Number(b.selected||b.terminal)-Number(a.selected||a.terminal)),project,zoom<13?24:zoom<16?15:9,240):data.stops;
      const labels=new Set(window.GregleTransitNetworkCore&&map.latLngToContainerPoint?window.GregleTransitNetworkCore.spaced(stops.filter(s=>zoom>=15||s.terminal),project,170,30):[]);
      for(const stop of stops){const label=document.createElement('span');label.textContent=stop.name;
        const marker=L.circleMarker([stop.lat,stop.lng],{radius:stop.selected?8:zoom<14?3:4,color:data.color||'#005fcc',weight:stop.selected?3:2,fillColor:stop.selected?'#005fcc':'#fff',fillOpacity:1,bubblingMouseEvents:false}).bindTooltip(label,{direction:'top',permanent:labels.has(stop),className:'transit-stop-label'}).addTo(group);
        if(onStop)marker.on?.('click',()=>onStop(stop));
      }
      container.classList.add('transit-route-active');title.textContent=`Route ${data.route}`;status.textContent=data.headsign;detail.textContent=data.network?`${data.stops.length} stops · ${data.variantCount} route variants · ${data.directionLabel}`:`${data.from} → ${data.to} · ${data.stops.length} stops. Selected departure’s direction and route variant.`;
      fit.hidden=false;retry.hidden=true;panel.removeAttribute('aria-busy');if(fitView)map.fire?.('transitroutechange',{active:true});
      if(fitView){fitRoute();vehicles?.show(data);}
    }
    function renderNetwork(fitView=true){
      if(!networkRoute)return;
      const variants=direction?.value&&direction.value!=='all'?networkRoute.variants.filter(v=>v.direction===direction.value):networkRoute.variants;
      const wanted=new Set(variants.flatMap(v=>v.stops)),terminals=new Set(variants.flatMap(v=>[v.stops[0],v.stops.at(-1)])),stops=networkStops.filter(s=>wanted.has(s.key)).map(s=>({...s,terminal:terminals.has(s.key)}));
      const data={network:true,route:networkRoute.number,routeId:networkRoute.routeId,color:networkRoute.color,headsign:networkRoute.name,mode:networkRoute.mode,paths:variants.map(v=>v.points),points:variants.flatMap(v=>v.points),stops,variantCount:variants.length,directionLabel:direction?.value==='all'?'All directions & branches':'Selected direction · all branches'};
      draw(data,fitView);
      if(stopList){stopList.replaceChildren();const seen=new Set();for(const id of variants.flatMap(v=>v.stops)){const stop=stops.find(s=>s.key===id);if(!stop||seen.has(id))continue;seen.add(id);const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=stop.name;button.addEventListener('click',()=>{map.setView([stop.lat,stop.lng],17);onStop?.(stop);});li.append(button);stopList.append(li);}}
    }
    function showNetwork(data,stops){
      if(!enabled||document.hidden)return;
      cancel();vehicles?.clear();map.closePopup();map.attributionControl?.removeAttribution(routeCredit);networkRoute=data;networkStops=stops;selection=null;panel.hidden=false;
      if(direction){direction.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='All directions & branches';direction.append(all);for(const id of new Set(data.variants.map(v=>v.direction))){const option=document.createElement('option');option.value=id;option.textContent=[...new Set(data.variants.filter(v=>v.direction===id).map(v=>v.headsign))].join(' / ');direction.append(option);}direction.value='all';direction.closest('label').hidden=false;}
      map.fire?.('transitroutefit');renderNetwork();
      // Let a mobile details drawer finish opening before computing map padding.
      if(window.requestAnimationFrame)window.requestAnimationFrame(()=>window.requestAnimationFrame(fitRoute));
    }
    async function align(data,token,signal){
      if(!window.GregleTransitRoads)return;
      const result=await window.GregleTransitRoads.match(data,{signal});
      if(token!==version||!enabled||document.hidden||!result.roadMatched)return;
      route=result;line.setLatLngs(result.points);casing.setLatLngs(result.points);map.attributionControl?.addAttribution(routeCredit);
    }
    async function show(row,stop,force=false){
      if(!enabled||document.hidden)return;
      cancel();vehicles?.clear();networkRoute=null;if(direction?.closest?.('label'))direction.closest('label').hidden=true;stopList?.replaceChildren?.();selection={row,stop};const token=version,key=core.tripURL(row),saved=cache.get(key);
      map.attributionControl?.removeAttribution(routeCredit);
      group.clearLayers();route=null;container.classList.remove('transit-route-active');panel.hidden=false;title.textContent=`Route ${row.route}`;status.textContent='Loading route…';detail.textContent=row.headsign;fit.hidden=true;retry.hidden=true;panel.setAttribute('aria-busy','true');map.closePopup();
      if(!force&&saved&&Date.now()-saved.time<300000){try{const result=core.readTrip(saved.data,row,stop);draw(result);const request=new AbortController();controller=request;try{await align(result,token,request.signal);}finally{if(token===version)controller=null;}return;}catch{cache.delete(key);}}
      if(!canRequest()||Date.now()-lastRequest<1500){status.textContent='Please wait briefly, then retry the route.';panel.removeAttribute('aria-busy');retry.hidden=false;return;}
      lastRequest=Date.now();const request=new AbortController();controller=request;
      try{const data=await requestJSON(key,request.signal);if(token!==version||!enabled||document.hidden)return;const result=core.readTrip(data,row,stop);cache.set(key,{data,time:Date.now()});while(cache.size>8)cache.delete(cache.keys().next().value);draw(result);await align(result,token,request.signal);}
      catch(error){if(token===version&&!request.signal.aborted){status.textContent='This route could not load. Retry, or use the operator schedule in the departure board.';retry.hidden=false;}}
      finally{if(token===version){controller=null;panel.removeAttribute('aria-busy');}}
    }
    close.addEventListener('click',()=>{clear();container.focus({preventScroll:true});});
    fit.addEventListener('click',fitRoute);
    retry.addEventListener('click',()=>{if(selection)show(selection.row,selection.stop,true);});
    direction?.addEventListener('change',()=>renderNetwork());
    map.on?.('zoomend resize',()=>{if(route)networkRoute?renderNetwork(false):draw(route,false);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&controller){cancel();if(!route){status.textContent='Route loading paused. Retry when ready.';retry.hidden=false;}panel.removeAttribute('aria-busy');}});
    window.addEventListener('gregle:transit-journey',clear);
    window.addEventListener('pagehide',clear);
    return {show,showNetwork,clear,setEnabled(value){if(enabled===(value===true))return;enabled=value===true;if(enabled)group.addTo(map);else{clear();map.removeLayer(group);}}};
  };
})();
