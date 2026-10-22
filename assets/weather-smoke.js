(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GregleSmoke=api.createController(root);
})(globalThis,function() {
  'use strict';
  function forecast(data,now=Date.now()) {
    const bounds=data?.bounds,frames=data?.frames,start=Date.parse(data?.start);
    if(!Array.isArray(bounds) || bounds.length!==2 || !bounds.every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isFinite)) ||
      bounds[0][0]<-85 || bounds[1][0]>85 || bounds[0][1]<-180 || bounds[1][1]>180 || bounds[0][0]>=bounds[1][0] || bounds[0][1]>=bounds[1][1]) throw Error('Invalid forecast bounds');
    if(!Number.isFinite(start) || start>now+6*3600000 || now-start>36*3600000 || !Array.isArray(frames) || frames.length<2 || frames.length>30) throw Error('Forecast unavailable or outdated');
    const result=frames.map((frame,index)=>{
      const time=Date.parse(frame.time);
      if(!Number.isFinite(time) || time<start || time>start+72*3600000 || (index && time<=Date.parse(frames[index-1].time)) ||
        typeof frame.image!=='string' || frame.image.length>500000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(frame.image)) throw Error('Invalid forecast frame');
      return {...frame,time};
    });
    if(result.at(-1).time+3600000<=now) throw Error('Forecast has expired');
    return {bounds,frames:result,start};
  }
  function inCoverage(bounds,location) {
    return location.latitude>=bounds[0][0] && location.latitude<=bounds[1][0] && location.longitude>=bounds[0][1] && location.longitude<=bounds[1][1];
  }
  function currentFrame(frames,now=Date.now()) {
    let index=0;frames.forEach((frame,i)=>{if(frame.time<=now)index=i;});return index;
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id);
    let active=false,location=null,map=null,marker=null,outline=null,data=null,layer=null,pending=null;
    let controller=null,version=0,renderVersion=0,playing=false,playTimer=null,current=0,lastFetch=0;
    function format(time) {
      let zone=location?.timezone || 'UTC';
      try {new Intl.DateTimeFormat('en',{timeZone:zone});} catch(_){zone='UTC';}
      return new Date(time).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23',minute:'2-digit',timeZone:zone,timeZoneName:'short'});
    }
    function cancelPending() { renderVersion++;if(pending){pending.cancel();pending=null;} }
    function stop() {playing=false;win.clearTimeout(playTimer);cancelPending();$('smokePlay').textContent='▶ Play';$('smokePlay').setAttribute('aria-pressed','false');}
    function status(message) {
      $('smokeStatus').textContent=message || (!inCoverage(data.bounds,location)?'Your selected location is outside this smoke forecast’s coverage. Pan to the outlined area or open FireSmoke.':
        `${win.Date.now()-data.start>18*3600000?'Older forecast · ':''}Forecast starts ${format(data.start)} · Drag the timeline to explore modelled smoke.`);
    }
    function controls(enabled) {$('smokeTime').disabled=!enabled;$('smokePlay').disabled=!enabled;}
    function recenter() {if(map && location)map.setView([location.latitude,location.longitude],6);}
    function ensureMap() {
      if(map)return;
      if(!win.L)throw Error('Map unavailable');
      map=win.L.map('smokeMap',{scrollWheelZoom:true,minZoom:2,maxZoom:10,fadeAnimation:false});
      win.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Data: <a href="https://firesmoke.ca/">BlueSky Canada / FireSmoke.ca</a>'}).addTo(map);
      marker=win.L.circleMarker([location.latitude,location.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#233e58',fillOpacity:1}).addTo(map);
      recenter();
    }
    async function show(index) {
      if(!active || !data || !map)return false;
      if(data.frames.at(-1).time+3600000<=win.Date.now() || win.Date.now()-data.start>36*3600000) {
        stop();controls(false);if(layer){map.removeLayer(layer);layer=null;}status('Smoke forecast has expired. Try Refresh or open FireSmoke.');return false;
      }
      cancelPending();const token=renderVersion,frame=data.frames[index];
      status('Loading smoke forecast image…');
      const next=win.L.imageOverlay(frame.image,data.bounds,{opacity:0,interactive:false});
      const loaded=await new Promise(resolve=>{
        let settled=false;
        const finish=ok=>{if(settled)return;settled=true;win.clearTimeout(timeout);next.off();resolve(ok);};
        const timeout=win.setTimeout(()=>finish(false),15000);
        pending={cancel:()=>{finish(false);map?.removeLayer(next);}};
        next.on('load',()=>finish(true));next.on('error',()=>finish(false));next.addTo(map);
      });
      if(token!==renderVersion || !active)return false;
      pending=null;
      if(!loaded){map.removeLayer(next);stop();status('Smoke image could not load. Try Refresh or open FireSmoke.');return false;}
      if(layer)map.removeLayer(layer);layer=next;layer.setOpacity(1);current=index;
      $('smokeTime').value=String(index);$('smokeTime').setAttribute('aria-valuetext',format(frame.time));
      $('smokeTimestamp').textContent=format(frame.time);status();return true;
    }
    async function refresh() {
      if(!active || !location)return;
      stop();controller?.abort();controller=new win.AbortController();const requestController=controller,signal=controller.signal,id=++version;
      controls(false);$('smokeRefresh').disabled=true;status('Checking FireSmoke forecast data…');
      const timeout=win.setTimeout(()=>requestController.abort(),15000);
      try {
        ensureMap();map.invalidateSize();
        const response=await win.fetch('data/smoke-forecast.json',{signal,cache:'no-cache'});
        if(!response.ok)throw Error('Forecast unavailable');
        const result=forecast(await response.json(),win.Date.now());
        if(id!==version || !active || signal.aborted)return;
        data=result;lastFetch=win.Date.now();
        if(layer){map.removeLayer(layer);layer=null;}
        if(outline)map.removeLayer(outline);
        outline=win.L.rectangle(data.bounds,{color:'#7b6b5f',weight:1,fill:false,dashArray:'4 4'}).addTo(map);
        current=currentFrame(data.frames,win.Date.now());
        $('smokeTime').max=String(data.frames.length-1);$('smokeStart').textContent=format(data.frames[0].time);$('smokeEnd').textContent=format(data.frames.at(-1).time);
        controls(true);await show(current);
      } catch(_) {
        if(id!==version || !active)return;
        if(layer){map.removeLayer(layer);layer=null;}data=null;controls(false);
        $('smokeTimestamp').textContent='Unavailable';status('Smoke forecast is unavailable or outdated. Try Refresh or open FireSmoke.');
      } finally {win.clearTimeout(timeout);if(id===version)$('smokeRefresh').disabled=false;}
    }
    function setLocation(value) {
      location=value;
      $('smokeSourceLink').href='https://firesmoke.ca/forecasts/current/?'+new URLSearchParams({lat:String(value.latitude),lon:String(value.longitude),zoom:'7'});
      if(active){stop();marker?.setLatLng([value.latitude,value.longitude]);recenter();if(data)show(current);}
    }
    function setActive(value) {
      active=value;
      if(!active){stop();controller?.abort();version++;if(map){map.remove();map=null;marker=null;outline=null;layer=null;}return;}
      refresh();
    }
    win.document.addEventListener('DOMContentLoaded',()=>{
      $('smokeRecenter').addEventListener('click',recenter);$('smokeRefresh').addEventListener('click',refresh);
      $('smokeTime').addEventListener('input',()=>{stop();show(Math.max(0,Math.min(data.frames.length-1,Number($('smokeTime').value))));});
      $('smokePlay').addEventListener('click',()=>{
        if(playing){stop();return;}if(!data || !active)return;
        playing=true;$('smokePlay').textContent='Ⅱ Pause';$('smokePlay').setAttribute('aria-pressed','true');
        async function tick(){if(!playing)return;if(!await show((current+1)%data.frames.length) || !playing)return;playTimer=win.setTimeout(tick,900);}
        tick();
      });
      win.document.addEventListener('visibilitychange',()=>{if(win.document.hidden)stop();else if(active && win.Date.now()-lastFetch>15*60000)refresh();});
      win.setInterval(()=>{if(active && !win.document.hidden && win.Date.now()-lastFetch>15*60000)refresh();},60000);
    });
    win.addEventListener('pagehide',()=>{stop();controller?.abort();});
    win.addEventListener('pageshow',event=>{if(event.persisted && active)refresh();});
    return {setLocation,setActive,refresh};
  }
  return {forecast,inCoverage,currentFrame,createController};
});
