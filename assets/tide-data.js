(function(root) {
  'use strict';
  const core=root.GregleTides, base='https://api-sine.dfo-mpo.gc.ca/api/v1';
  let directory=null;
  async function json(url,signal) {
    const controller=new AbortController(), abort=()=>controller.abort();
    if(signal?.aborted) throw Error('Cancelled');
    signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,12000);
    try {
      const r=await fetch(url,{signal:controller.signal});
      if(!r.ok) throw Error('Tide service unavailable');
      return await r.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort',abort); }
  }
  async function load(location,signal,now=Date.now()) {
    let canadianFailure=false;
    if(location.country==='CA') {
      try {
        if(!directory) directory=await json(base+'/stations',signal);
        const station=core.nearestStation(directory,location);
        if(station) {
          const from=new Date(now-2*86400000).toISOString(), to=new Date(now+8*86400000).toISOString();
          const url=base+'/stations/'+station.id+'/data?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);
          const [curve,hilo]=await Promise.all([json(url+'&time-series-code=wlp&resolution=FIFTEEN_MINUTES',signal),json(url+'&time-series-code=wlp-hilo',signal)]);
          const points=core.predictions(curve), events=core.extremes(core.predictions(hilo));
          if(!points.some(p=>p.time>=now) || !events.some(p=>p.time>=now)) throw Error('No current station predictions');
          return {points,events,timezone:core.timezone(location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),model:false,
            station:station.officialName+' · '+station.distance.toFixed(1)+' km from '+location.name, source:'Canadian Hydrographic Service',
            sourceURL:'https://www.tides.gc.ca/en/stations/'+station.code,datum:'Metres above chart datum',
            note:'Predicted tides at the named station. Local conditions and weather can change actual water levels. Check official guidance before going on the water.'};
        }
      } catch(error) { if(signal?.aborted) throw error; canadianFailure=true; }
    }
    const result=core.marine(await json(core.marineURL(location),signal),location);
    if(result && canadianFailure) result.note='Canadian station data is unavailable. '+result.note;
    return result;
  }
  root.GregleTideData={load};
})(globalThis);
