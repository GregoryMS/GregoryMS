(function(root) {
  'use strict';
  const ENDPOINT='https://geo.weather.gc.ca/geomet';
  const definitions={
    wind:{name:'Wind',layer:'GDPS_15km_Winds_10m',style:'WINDARROWKMH',opacity:0.9,zIndex:350},
    clouds:{name:'Clouds',layer:'GDPS_15km_TotalCloudCover',style:'CLOUD',opacity:0.55,zIndex:250}
  };
  function metadata(xml,name) {
    const doc=new root.DOMParser().parseFromString(xml,'text/xml');
    if(doc.querySelector('parsererror'))throw Error('Invalid layer metadata');
    const layer=[...doc.querySelectorAll('Layer')].find(l=>[...l.children].some(c=>c.localName==='Name' && c.textContent===name));
    const dimension=key=>[...(layer?.children || [])].find(c=>c.localName==='Dimension' && c.getAttribute('name')===key)?.getAttribute('default');
    const time=dimension('time'),run=dimension('reference_time');
    if(!time || !run || !Number.isFinite(Date.parse(time)) || !Number.isFinite(Date.parse(run)))throw Error('Missing forecast time');
    // Never present an old service snapshot as a current forecast.
    if(Math.abs(Date.now()-Date.parse(time))>6*3600000 || Date.now()-Date.parse(run)>48*3600000)throw Error('Forecast is delayed');
    return {time,run};
  }
  function attach(map,getLocation) {
    const $=id=>document.getElementById(id),states={};
    function stamp(value) {
      let zone=getLocation()?.timezone;
      try { return new Date(value).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone,timeZoneName:'short'}); }
      catch(_) { return new Date(value).toLocaleString('en-CA',{timeZone:'UTC',timeZoneName:'short'}); }
    }
    function status() {
      const active=Object.values(states).filter(s=>s.input.checked);
      $('radarLayerStatus').hidden=!active.length;
      $('radarLayerStatus').textContent=active.map(s=>s.error?`${s.def.name} unavailable — try Refresh.`:s.loading?`Loading ${s.def.name.toLowerCase()}…`:`${s.def.name} forecast: ${stamp(s.time)}`).join(' · ');
      $('radarLayerNote').hidden=!active.length;
    }
    function clear(s) {
      s.version++;s.controller?.abort();s.controller=null;
      clearTimeout(s.timer);s.timer=null;
      if(s.layer){s.layer.off();map.removeLayer(s.layer);s.layer=null;}
    }
    async function load(s) {
      clear(s);s.error=false;s.loading=true;status();
      const version=s.version,controller=new AbortController();s.controller=controller;
      const timeout=setTimeout(()=>controller.abort(),15000);
      try {
        const query=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetCapabilities',LAYERS:s.def.layer});
        const response=await fetch(`${ENDPOINT}?${query}`,{signal:controller.signal,cache:'no-cache'});
        if(!response.ok)throw Error('Layer unavailable');
        const info=metadata(await response.text(),s.def.layer);
        if(version!==s.version || !s.input.checked)return;
        s.time=info.time;
        const layer=root.L.tileLayer.wms(ENDPOINT,{
          layers:s.def.layer,styles:s.def.style,version:'1.3.0',format:'image/png',transparent:true,
          time:info.time,dim_reference_time:info.run,opacity:s.def.opacity,zIndex:s.def.zIndex,
          maxZoom:10,tileSize:256,updateWhenIdle:true,keepBuffer:0,
          attribution:'Weather layers: <a href="https://eccc-msc.github.io/open-data/msc-geomet/readme_en/">ECCC / MSC GeoMet</a>'
        });
        s.layer=layer;
        const fail=()=>{if(version!==s.version)return;clear(s);s.error=true;s.loading=false;status();};
        const loading=()=>{if(version!==s.version)return;s.loading=true;clearTimeout(s.timer);s.timer=setTimeout(fail,20000);status();};
        layer.on('loading',loading);
        layer.on('tileerror',fail);
        layer.on('load',()=>{if(version!==s.version)return;clearTimeout(s.timer);s.loading=false;status();});
        loading();layer.addTo(map);
      } catch(_) {
        if(version===s.version){s.error=true;s.loading=false;status();}
      } finally { clearTimeout(timeout);if(version===s.version)s.controller=null; }
    }
    for(const [key,def] of Object.entries(definitions)) {
      const input=$(`radarLayer-${key}`),legend=$(`radarLegend-${key}`);
      const s=states[key]={def,input,version:0,layer:null,loading:false,error:false};
      if(!root.L.tileLayer.wms){input.disabled=true;continue;}
      input.disabled=false;
      input.addEventListener('change',()=>{
        legend.hidden=!input.checked;
        if(input.checked) {
          const img=legend.querySelector('img');
          if(!img.src)img.src=`${ENDPOINT}?${new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetLegendGraphic',SLD_VERSION:'1.1.0',LAYER:def.layer,STYLE:def.style,FORMAT:'image/png'})}`;
          load(s);
        } else {clear(s);status();}
      });
    }
    const refresh=()=>{for(const s of Object.values(states))if(s.input.checked)load(s);};
    // Only active overlays refresh; precipitation owns its separate history.
    const schedule=()=>setInterval(()=>{if(!document.hidden)refresh();},300000);
    let interval=schedule();
    root.addEventListener('pagehide',()=>{clearInterval(interval);for(const s of Object.values(states))clear(s);});
    root.addEventListener('pageshow',event=>{if(event.persisted){interval=schedule();refresh();}});
    return {refresh,status};
  }
  root.GregleWeatherLayers={attach,metadata};
})(globalThis);
