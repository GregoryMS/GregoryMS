(function(root) {
  'use strict';
  const ENDPOINT='https://geo.weather.gc.ca/geomet';
  const LAYER='Lightning_2.5km_Density';
  function timesFrom(value) {
    const [start,end,period]=String(value).trim().split('/');
    const first=Date.parse(start),last=Date.parse(end);
    if(period!=='PT10M' || !Number.isFinite(first) || !Number.isFinite(last) || last<first || last-first>86400000)throw Error('Invalid lightning times');
    return Array.from({length:Math.floor((last-first)/600000)+1},(_,i)=>first+i*600000);
  }
  function matchTime(times,seconds) {
    const target=seconds*1000;
    // Never put a later lightning observation on an earlier radar frame.
    return [...times].reverse().find(t=>t<=target && target-t<=1200000) ?? null;
  }
  if(typeof module!=='undefined' && module.exports){module.exports={timesFrom,matchTime};return;}
  const $=id=>document.getElementById(id);
  let map=null,location=null,frame=null,times=[],layer=null,tileTimer=null,controller=null;
  let enabled=true,active=true,version=0,lastChecked=0,failed=false,shownTime=null;
  function remove() {
    version++;clearTimeout(tileTimer);tileTimer=null;shownTime=null;
    if(layer){layer.off();map.removeLayer(layer);layer=null;}
  }
  function stamp(value) {
    let zone=location?.timezone || 'UTC';
    try {new Intl.DateTimeFormat('en',{timeZone:zone});} catch(_){zone='UTC';}
    return new Date(value).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23',minute:'2-digit',timeZone:zone,timeZoneName:'short'});
  }
  function render() {
    const status=$('lightningStatus');
    $('lightningKey').hidden=!enabled;
    if(!enabled || !active || document.hidden){remove();status.textContent=enabled?'Lightning paused.':'Lightning overlay off.';return;}
    if(!map || !frame){status.textContent='Lightning loads with the radar.';return;}
    if(failed){remove();status.textContent='Lightning unavailable — try Refresh. Precipitation radar is still available.';return;}
    const selected=matchTime(times,frame.time);
    if(selected===null){remove();status.textContent=times.length?'No lightning image is available for this radar time.':'Loading lightning observations…';return;}
    if(shownTime===selected && layer)return;
    remove();shownTime=selected;
    const token=version;
    const description=`Lightning · 10 minutes ending ${stamp(selected)} · Canada & nearby borders`;
    status.textContent='Loading lightning observations…';
    layer=root.L.tileLayer.wms(ENDPOINT,{
      layers:LAYER,styles:'Lightning',format:'image/png',transparent:true,version:'1.1.1',
      time:new Date(selected).toISOString().replace('.000Z','Z'),opacity:0,zIndex:450,maxZoom:10,
      bounds:[[31.541389,-156.145350],[73.723389,-38.694350]],
      attribution:'Lightning: <a href="https://eccc-msc.github.io/open-data/msc-data/lightning/readme_lightning_en/">ECCC / CLDN</a>'
    });
    const fail=()=>{
      if(token!==version)return;
      remove();status.textContent='Lightning image could not load — try Refresh.';
    };
    layer.on('loading',()=>{
      if(token!==version)return;
      layer.setOpacity(0);status.textContent='Loading lightning observations…';
      clearTimeout(tileTimer);tileTimer=setTimeout(fail,15000);
    });
    layer.on('tileerror',fail);
    layer.on('load',()=>{
      if(token!==version)return;
      clearTimeout(tileTimer);layer.setOpacity(.9);status.textContent=description;
    });
    tileTimer=setTimeout(fail,15000);layer.addTo(map);
  }
  async function refresh(force=false) {
    if(!map || !enabled || !active || document.hidden || controller || (!force && Date.now()-lastChecked<300000))return;
    lastChecked=Date.now();
    const current=new AbortController();controller=current;
    const timeout=setTimeout(()=>current.abort(),15000);
    try {
      const response=await fetch(`${ENDPOINT}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${LAYER}`,{signal:current.signal,cache:'no-cache'});
      if(!response.ok)throw Error('Lightning unavailable');
      const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
      const dimension=[...xml.getElementsByTagName('Dimension')].find(node=>node.getAttribute('name')==='time');
      const available=timesFrom(dimension?.textContent);
      if(Date.now()-available.at(-1)>30*60000 || available.at(-1)>Date.now()+60000)throw Error('Lightning feed delayed');
      times=available;lastChecked=Date.now();failed=false;
      if(force)remove();
    } catch(_) {failed=true;}
    finally {clearTimeout(timeout);controller=null;render();}
  }
  root.GregleLightning={
    attach(value){map=value;refresh(true);},
    setLocation(value){location=value;remove();},
    setFrame(value){frame=value;render();refresh();},
    setActive(value){active=value;render();if(value)refresh();},
    refresh:()=>refresh(true)
  };
  document.addEventListener('DOMContentLoaded',()=>{
    $('lightningToggle').checked=enabled;
    $('lightningToggle').addEventListener('change',()=>{enabled=$('lightningToggle').checked;render();if(enabled)refresh();});
    document.addEventListener('visibilitychange',()=>{render();if(!document.hidden)refresh();});
    setInterval(()=>{if(times.length && Date.now()-times.at(-1)>30*60000){failed=true;render();}refresh();},60000);
  });
  root.addEventListener('pagehide',()=>{controller?.abort();remove();});
  root.addEventListener('pageshow',event=>{if(event.persisted){render();refresh();}});
})(globalThis);
