(() => {
  'use strict';
  window.GregleTransitVehicles=({map})=>{
    const core=window.GregleTransitCore,group=L.layerGroup(),markers=new Map(),status=document.getElementById('transit-vehicle-status'),credit=document.getElementById('transit-vehicle-credit');
    let selected,controller,pollTimer,ageTimer,version=0,snapshot,offset=0,retryAt=0,failed=false;
    const make=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
    function pause(){version++;controller?.abort();controller=null;clearTimeout(pollTimer);clearTimeout(ageTimer);group.clearLayers();markers.clear();map.removeLayer(group);}
    function clear(){pause();selected=null;snapshot=null;status.hidden=true;credit.hidden=true;}
    function report(text){status.textContent=text;status.hidden=false;}
    function render(){
      clearTimeout(ageTimer);if(!selected||document.hidden||!snapshot?.supported)return;
      const now=Date.now()+offset,vehicles=snapshot.vehicles.filter(v=>v.observed>=now-snapshot.maxAgeSeconds*1000&&v.observed<=now+30000);
      const current=new Set(vehicles.map(v=>v.id));for(const [id,marker] of markers)if(!current.has(id)){group.removeLayer(marker);markers.delete(id);}
      for(const vehicle of vehicles){
        const bearing=vehicle.bearing,heading=bearing===null?null:['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round(bearing/45)%8];
        const direction=heading?`Heading ${heading} (${Math.round(bearing)%360}°), as reported with this GPS fix.`:'Direction of travel is not reported for this bus.';
        const iconBody=make('span','🚌');iconBody.setAttribute('aria-hidden','true');
        const label=make('b',selected.route);const iconNode=document.createElement('span');iconNode.append(iconBody,label);
        if(heading){const arrow=document.createElement('i');arrow.className='transit-vehicle-heading';arrow.style.transform=`rotate(${bearing}deg)`;arrow.setAttribute('aria-hidden','true');iconNode.append(arrow);}
        iconNode.setAttribute('role','img');iconNode.setAttribute('aria-label',`Route ${selected.route} · ${direction}`);
        const icon=L.divIcon({className:'transit-vehicle-marker',html:iconNode,iconSize:[44,36],iconAnchor:[22,18]});
        const age=Math.max(0,Math.round((now-vehicle.observed)/1000)),name=`Route ${selected.route} · Bus ${vehicle.label}`;
        const popup=document.createElement('section');popup.append(make('strong',name),make('p',direction),make('p',`GPS position reported ${age} seconds ago. ${snapshot.source}.`),make('p','Buses are shown in both directions. The blue line follows your selected departure.'));
        const tooltip=make('span',`${name} · ${heading?'heading '+heading:'direction unavailable'} · ${age}s ago`),previous=markers.get(vehicle.id);
        if(previous){previous.setLatLng([vehicle.lat,vehicle.lng]).setPopupContent(popup).setTooltipContent(tooltip);if(previous.transitBearing!==bearing)previous.setIcon(icon);}
        else markers.set(vehicle.id,L.marker([vehicle.lat,vehicle.lng],{icon,title:name,alt:name,keyboard:true,riseOnHover:true,zIndexOffset:800,bubblingMouseEvents:false}).bindPopup(popup,{maxWidth:260}).bindTooltip(tooltip,{direction:'top'}).addTo(group));
        markers.get(vehicle.id).transitBearing=bearing;
      }
      if(failed)report(vehicles.length?`${vehicles.length} bus${vehicles.length===1?'':'es'} · live updates delayed. Old GPS positions disappear automatically.`:'Live bus positions temporarily unavailable. Retrying automatically.');
      else if(vehicles.length){const age=Math.max(0,Math.round((now-Math.max(...vehicles.map(v=>v.observed)))/1000));report(`${vehicles.length} live bus${vehicles.length===1?'':'es'} · both directions · latest GPS ${age}s ago`);}
      else report('No fresh live buses reported for this route right now.');
      ageTimer=setTimeout(render,10000);
    }
    async function refresh(){
      if(!selected||document.hidden||controller)return;
      if(Date.now()<retryAt){pollTimer=setTimeout(refresh,retryAt-Date.now());return;}
      const token=version,request=new AbortController();controller=request;let wait=30000;
      try{
        const response=await fetch(core.vehiclesURL(selected.routeId),{signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)]),credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
        if(!response.ok){const raw=response.headers.get('Retry-After'),seconds=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw||'')-Date.now())/1000);wait=Math.min(3600000,Math.max(60000,seconds*1000||60000));throw Error('Vehicle feed unavailable');}
        const data=core.readVehiclePositions(await response.json(),selected.routeId);
        if(token!==version||document.hidden)return;
        snapshot=data;failed=false;retryAt=0;
        if(!data.supported){report('Live bus tracking is not available for this service.');credit.hidden=true;return;}
        offset=data.now-Date.now();credit.textContent=data.source==='TransLink'?'Contains information licensed by TransLink.':'Contains information distributed by BC Transit.';credit.href=data.source==='TransLink'?'https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources':'https://www.bctransit.com/open-data/';credit.hidden=false;render();
      }catch(error){if(token!==version||request.signal.aborted)return;failed=true;retryAt=Date.now()+wait;if(snapshot)render();else report('Live bus positions temporarily unavailable. Retrying automatically.');}
      finally{if(token===version){controller=null;if(snapshot?.supported!==false)pollTimer=setTimeout(refresh,wait);}}
    }
    function show(data){clear();const url=core.vehiclesURL(data.routeId);if(!url)return;selected={routeId:data.routeId,route:data.route};snapshot=null;failed=false;group.addTo(map);report('Loading live buses…');refresh();}
    document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();if(selected)report('Live bus tracking paused while this tab is hidden.');}else if(selected){group.addTo(map);if(snapshot)render();refresh();}});
    window.addEventListener('pagehide',clear);
    return {show,clear};
  };
})();
