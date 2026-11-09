(() => {
  'use strict';
  window.GregleTransitRoute=({map,requestJSON,canRequest})=>{
    const core=window.GregleTransitCore,group=L.layerGroup(),cache=new Map(),vehicles=window.GregleTransitVehicles?.({map});
    const panel=document.getElementById('transit-route-card'),title=document.getElementById('transit-route-title'),status=document.getElementById('transit-route-status'),detail=document.getElementById('transit-route-detail'),fit=document.getElementById('transit-route-fit'),retry=document.getElementById('transit-route-retry'),close=document.getElementById('transit-route-clear'),container=map.getContainer();
    let enabled=false,controller,version=0,route,selection,lastRequest=0;
    function cancel(){version++;controller?.abort();controller=null;}
    function clear(){cancel();vehicles?.clear();group.clearLayers();route=null;selection=null;panel.hidden=true;container.classList.remove('transit-route-active');}
    function fitRoute(){if(!route)return;const size=map.getSize();map.fitBounds(L.latLngBounds(route.points),{paddingTopLeft:[20,95],paddingBottomRight:[70,Math.min(210,size.y*.3)],maxZoom:16});}
    function draw(data){
      route=data;group.clearLayers();
      L.polyline(data.points,{color:'#fff',weight:11,opacity:.95,interactive:false}).addTo(group);
      L.polyline(data.points,{color:'#005fcc',weight:6,opacity:1,interactive:false}).addTo(group);
      for(const stop of data.stops){const label=document.createElement('span');label.textContent=stop.name;
        L.circleMarker([stop.lat,stop.lng],{radius:stop.selected?8:4,color:'#005fcc',weight:stop.selected?3:2,fillColor:stop.selected?'#005fcc':'#fff',fillOpacity:1}).bindTooltip(label,{direction:'top'}).addTo(group);
      }
      container.classList.add('transit-route-active');title.textContent=`Route ${data.route}`;status.textContent=data.headsign;detail.textContent=`${data.from} → ${data.to} · ${data.stops.length} stops. Selected departure’s direction and route variant.`;
      fit.hidden=false;retry.hidden=true;panel.removeAttribute('aria-busy');fitRoute();vehicles?.show(data);
    }
    async function show(row,stop,force=false){
      if(!enabled||document.hidden)return;
      cancel();vehicles?.clear();selection={row,stop};const token=version,key=core.tripURL(row),saved=cache.get(key);
      group.clearLayers();route=null;container.classList.remove('transit-route-active');panel.hidden=false;title.textContent=`Route ${row.route}`;status.textContent='Loading route…';detail.textContent=row.headsign;fit.hidden=true;retry.hidden=true;panel.setAttribute('aria-busy','true');map.closePopup();
      if(!force&&saved&&Date.now()-saved.time<300000){try{draw(core.readTrip(saved.data,row,stop));return;}catch{cache.delete(key);}}
      if(!canRequest()||Date.now()-lastRequest<1500){status.textContent='Please wait briefly, then retry the route.';panel.removeAttribute('aria-busy');retry.hidden=false;return;}
      lastRequest=Date.now();const request=new AbortController();controller=request;
      try{const data=await requestJSON(key,request.signal);if(token!==version||!enabled||document.hidden)return;const result=core.readTrip(data,row,stop);cache.set(key,{data,time:Date.now()});while(cache.size>8)cache.delete(cache.keys().next().value);draw(result);}
      catch(error){if(token===version&&!request.signal.aborted){status.textContent='This route could not load. Retry, or use the operator schedule in the departure board.';retry.hidden=false;}}
      finally{if(token===version){controller=null;panel.removeAttribute('aria-busy');}}
    }
    close.addEventListener('click',()=>{clear();container.focus({preventScroll:true});});
    fit.addEventListener('click',fitRoute);
    retry.addEventListener('click',()=>{if(selection)show(selection.row,selection.stop,true);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&controller){cancel();status.textContent='Route loading paused. Retry when ready.';retry.hidden=false;panel.removeAttribute('aria-busy');}});
    window.addEventListener('pagehide',clear);
    return {show,clear,setEnabled(value){if(enabled===(value===true))return;enabled=value===true;if(enabled)group.addTo(map);else{clear();map.removeLayer(group);}}};
  };
})();
