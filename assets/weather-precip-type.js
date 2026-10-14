(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.GreglePrecipType=api.createController(root);
})(globalThis,function() {
  'use strict';
  const ENDPOINT='https://geo.weather.gc.ca/geomet',LAYER='Radar_1km_SfcPrecipType';
  function framesFrom(value,now=Date.now()) {
    const [start,end,step]=String(value).trim().split('/'),first=Date.parse(start),last=Date.parse(end);
    if(step!=='PT6M' || !Number.isFinite(first) || !Number.isFinite(last) || last<first || last-first>6*3600000 || last>now+60000 || now-last>30*60000)throw Error('Precipitation type unavailable or delayed');
    return Array.from({length:Math.floor((last-first)/360000)+1},(_,i)=>first+i*360000).slice(-31);
  }
  function layerOptions(time) {
    return {layers:LAYER,styles:'SfcPrecipType_Dis',format:'image/png',transparent:true,version:'1.1.1',
      time:new Date(time).toISOString().replace('.000Z','Z'),opacity:0,zIndex:300,maxZoom:10,
      attribution:'Precipitation type: <a href="https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/">ECCC</a>'};
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id);
    let active=false,location=null,map=null,marker=null,base=null,frames=[],current=0,layer=null,pending=null;
    let controller=null,version=0,renderVersion=0,playing=false,playTimer=null,lastFetch=0,baseFailed=false;
    const status=message=>{$('ptypeStatus').textContent=message;};
    function format(time) {
      let zone=location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch(_){zone='UTC';}
      return new Date(time).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone,timeZoneName:'short'});
    }
    function cancelPending(){renderVersion++;if(pending){pending.cancel();pending=null;}}
    function stop(){playing=false;win.clearTimeout(playTimer);cancelPending();$('ptypePlay').textContent='▶ Play';$('ptypePlay').setAttribute('aria-pressed','false');if(layer)status('Paused · Drag the timeline or select Play to explore precipitation types.');}
    function controls(enabled){$('ptypeTime').disabled=!enabled;$('ptypePlay').disabled=!enabled || frames.length<2;}
    function removeLayer(){if(layer){layer.off();map.removeLayer(layer);layer=null;}}
    function recenter(){if(map && location)map.setView([location.latitude,location.longitude],7);}
    function ensureMap() {
      if(map)return;
      if(!win.L)throw Error('Map unavailable');
      map=win.L.map('ptypeMap',{scrollWheelZoom:true,minZoom:2,maxZoom:10,fadeAnimation:false});
      base=win.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
      base.on('tileerror',()=>{baseFailed=true;status('The background map could not fully load. Try Refresh.');});
      marker=win.L.circleMarker([location.latitude,location.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#233e58',fillOpacity:1}).addTo(map);
      recenter();
      map.on('movestart',()=>{stop();removeLayer();});
      map.on('moveend',()=>{if(active && frames.length)show(current);});
    }
    async function show(index) {
      if(!active || !frames.length || !map)return false;
      if(win.Date.now()-frames.at(-1)>30*60000){stop();removeLayer();controls(false);status('Precipitation-type data is delayed. Try Refresh or open Environment Canada.');return false;}
      cancelPending();const token=renderVersion,selected=Math.max(0,Math.min(frames.length-1,index)),time=frames[selected];
      $('ptypeTime').value=String(current);status('Loading precipitation types…');
      const next=win.L.tileLayer.wms(ENDPOINT,layerOptions(time));
      const loaded=await new Promise(resolve=>{
        let settled=false;
        const finish=ok=>{if(settled)return;settled=true;win.clearTimeout(timeout);next.off();resolve(ok);};
        const timeout=win.setTimeout(()=>finish(false),15000);
        pending={cancel:()=>{finish(false);map?.removeLayer(next);}};
        next.on('load',()=>finish(true));next.on('tileerror',()=>finish(false));next.addTo(map);
      });
      if(token!==renderVersion || !active)return false;
      pending=null;
      if(!loaded){map.removeLayer(next);stop();status('Precipitation-type image could not load. '+(layer?'Showing the previous image. ':'')+'Try Refresh.');return false;}
      removeLayer();layer=next;layer.setOpacity(.8);current=selected;
      $('ptypeTime').value=String(current);$('ptypeTime').setAttribute('aria-valuetext',format(time));$('ptypeTimestamp').textContent=format(time);
      status(baseFailed?'The background map could not fully load. Try Refresh.':'Environment Canada · Updated every 6 minutes · Coverage varies across North America.');return true;
    }
    async function refresh() {
      if(!active || !location || win.document.hidden)return;
      stop();controller?.abort();const requestController=new win.AbortController();controller=requestController;
      const id=++version;lastFetch=win.Date.now();controls(false);$('ptypeRefresh').disabled=true;status('Checking Environment Canada precipitation types…');
      const timeout=win.setTimeout(()=>requestController.abort(),15000);
      try {
        ensureMap();map.invalidateSize();
        const response=await win.fetch(`${ENDPOINT}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${LAYER}`,{signal:requestController.signal,cache:'no-cache'});
        if(!response.ok)throw Error('Unavailable');
        const xml=new win.DOMParser().parseFromString(await response.text(),'application/xml');
        const dimension=[...xml.getElementsByTagName('Dimension')].find(node=>node.getAttribute('name')==='time');
        const result=framesFrom(dimension?.textContent,win.Date.now());
        if(id!==version || !active || requestController.signal.aborted)return;
        removeLayer();frames=result;current=frames.length-1;
        $('ptypeTime').max=String(current);$('ptypeStart').textContent=format(frames[0]);controls(true);
        await show(current);
      }catch(_){
        if(id!==version || !active)return;
        removeLayer();frames=[];controls(false);$('ptypeTimestamp').textContent='Unavailable';status('Precipitation types are unavailable or delayed. Try Refresh or open Environment Canada.');
      }finally{win.clearTimeout(timeout);if(id===version){controller=null;$('ptypeRefresh').disabled=false;}}
    }
    function setLocation(value){
      location=value;
      if(active){stop();marker?.setLatLng([value.latitude,value.longitude]);recenter();if(!map)refresh();}
    }
    function setActive(value){
      active=value;
      if(!active){stop();controller?.abort();controller=null;version++;if(map){removeLayer();map.remove();map=null;marker=null;base=null;}frames=[];return;}
      refresh();
    }
    win.document.addEventListener('DOMContentLoaded',()=>{
      $('ptypeRecenter').addEventListener('click',recenter);
      $('ptypeRefresh').addEventListener('click',()=>{baseFailed=false;base?.redraw();refresh();});
      $('ptypeTime').addEventListener('input',()=>{stop();show(Number($('ptypeTime').value));});
      $('ptypePlay').addEventListener('click',()=>{
        if(playing){stop();return;}if(!active || controller || frames.length<2)return;
        playing=true;$('ptypePlay').textContent='Ⅱ Pause';$('ptypePlay').setAttribute('aria-pressed','true');
        async function tick(){if(!playing)return;if(!await show((current+1)%frames.length) || !playing)return;playTimer=win.setTimeout(tick,current===frames.length-1?1600:600);}
        tick();
      });
      win.document.addEventListener('visibilitychange',()=>{if(win.document.hidden)stop();else if(active)refresh();});
      win.setInterval(()=>{if(active && !win.document.hidden && !controller && win.Date.now()-lastFetch>300000)refresh();},60000);
    });
    win.addEventListener('pagehide',()=>{stop();controller?.abort();version++;controller=null;});
    win.addEventListener('pageshow',event=>{if(event.persisted && active)refresh();});
    return {setLocation,setActive,refresh};
  }
  return {framesFrom,layerOptions,createController};
});
