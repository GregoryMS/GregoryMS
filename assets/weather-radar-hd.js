(function(root) {
  'use strict';
  const BASE='https://opengeo.ncep.noaa.gov/geoserver/';
  function sourceFor(station='') {
    if(station && !/^[KP][A-Z0-9]{3}$/.test(station))throw Error('Invalid radar station');
    const workspace=station?station.toLowerCase():'conus';
    return {id:station || 'mrms',endpoint:`${BASE}${workspace}/ows`,
      layer:station?`${workspace}_sr_bref`:'conus_bref_qcd'};
  }
  function timesFrom(value,now=Date.now()) {
    const text=String(value || '').trim();
    let times;
    if(text.includes('/')) {
      const [start,end,period]=text.split('/'),match=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(period);
      const first=Date.parse(start),last=Date.parse(end);
      const step=match?((+match[1]||0)*3600+(+match[2]||0)*60+(+match[3]||0))*1000:0;
      if(!step || !Number.isFinite(first) || !Number.isFinite(last) || last<first || (last-first)/step>1000)throw Error('Invalid radar times');
      times=Array.from({length:Math.floor((last-first)/step)+1},(_,i)=>first+i*step);
    } else times=text.split(',').map(t=>Date.parse(t));
    times=[...new Set(times.filter(t=>Number.isFinite(t) && t<=now+60000 && t>=now-3*3600000))].sort((a,b)=>a-b);
    if(!times.length)throw Error('No recent high-resolution radar scans');
    // Keep the full two-hour window while limiting animation memory and requests.
    const latest=times.at(-1);
    times=times.filter(t=>t>=latest-2*3600000);
    if(times.length>25)times=Array.from({length:25},(_,i)=>times[Math.round(i*(times.length-1)/24)]);
    return times;
  }
  function framesFromXML(text,source,now=Date.now()) {
    const xml=new root.DOMParser().parseFromString(text,'application/xml');
    if(xml.getElementsByTagName('parsererror').length)throw Error('Invalid radar metadata');
    const layer=[...xml.getElementsByTagName('Layer')].find(node=>
      [...node.children].some(child=>child.localName==='Name' && child.textContent.trim()===source.layer));
    const dimension=layer && [...layer.children].find(node=>node.localName==='Dimension' && node.getAttribute('name')==='time');
    return timesFrom(dimension?.textContent,now).map(t=>({time:t/1000,path:`hd:${source.id}:${t}`,
      hd:{...source,time:new Date(t).toISOString()}}));
  }
  function distance(site,location) {
    const rad=Math.PI/180,a=(site.lat-location.latitude)*rad,b=(site.lon-location.longitude)*rad;
    return 12742*Math.asin(Math.sqrt(Math.min(1,Math.sin(a/2)**2+Math.cos(site.lat*rad)*Math.cos(location.latitude*rad)*Math.sin(b/2)**2)));
  }
  const core={sourceFor,timesFrom,framesFromXML,distance};
  if(typeof module!=='undefined' && module.exports){module.exports=core;return;}
  root.GregleHighResRadar={...core,
    async load(station,signal) {
      const source=sourceFor(station);
      const response=await fetch(`${source.endpoint}?service=WMS&version=1.3.0&request=GetCapabilities`,{signal,cache:'no-cache'});
      if(!response.ok)throw Error('High-resolution radar unavailable');
      return {host:'',frames:framesFromXML(await response.text(),source)};
    },
    createLayer(frame) {
      return root.L.tileLayer.wms(frame.hd.endpoint,{layers:frame.hd.layer,styles:'',format:'image/png',transparent:true,
        version:'1.1.1',time:frame.hd.time,tileSize:512,maxZoom:10,opacity:0,updateWhenIdle:true,keepBuffer:0,zIndex:300,
        attribution:'Radar: <a href="https://opengeo.ncep.noaa.gov/geoserver/www/index.html">NOAA / NWS</a>'});
    }
  };
})(globalThis);
