(function(root) {
  'use strict';
  const weather = typeof module !== 'undefined' && module.exports ? require('./weather-core.js') : root.GregleWeather;
  function timezone(value) {
    try { new Intl.DateTimeFormat('en', {timeZone:value}).format(); return value || 'UTC'; } catch (_) { return 'UTC'; }
  }
  function locationFromURL(href) {
    const p = new URL(href || 'https://gregle.uk/').searchParams;
    if (!p.get('lat')?.trim() || !p.get('lon')?.trim()) return null;
    const latitude=Number(p.get('lat')), longitude=Number(p.get('lon'));
    if (!weather.coordinates(latitude,longitude)) return null;
    return {latitude,longitude,name:(p.get('name') || 'Selected location').slice(0,100),region:(p.get('region') || '').slice(0,150),
      country:/^[A-Z]{2}$/.test(p.get('country')) ? p.get('country') : null,timezone:timezone(p.get('tz') || 'UTC')};
  }
  function locationURL(page,location) {
    const url=new URL(page,'https://gregle.uk/');
    if (location && weather.coordinates(location.latitude,location.longitude)) {
      for (const [key,value] of Object.entries({lat:location.latitude,lon:location.longitude,name:location.name,region:location.region,country:location.country,tz:location.timezone})) {
        if (value!==undefined && value!==null && value!=='') url.searchParams.set(key,String(value));
      }
    }
    return page+url.search;
  }
  function dayKey(time,zone) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone(zone),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time)); }
  function dayKeys(now,zone,count=7) {
    const start=Date.parse(dayKey(now,zone)+'T12:00:00Z');
    return Array.from({length:count},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
  }
  function nearestStation(data,location) {
    if (!Array.isArray(data)) throw Error('Invalid station directory');
    return data.filter(s=>/^[a-f0-9]{24}$/.test(s.id) && /^\d{5}$/.test(s.code) && s.officialName && weather.coordinates(s.latitude,s.longitude) &&
      s.timeSeries?.some(t=>t.code==='wlp-hilo') && s.timeSeries?.some(t=>t.code==='wlp'))
      .map(s=>({...s,distance:weather.distance(location,s)})).filter(s=>s.distance<=30).sort((a,b)=>a.distance-b.distance)[0] || null;
  }
  function predictions(data) {
    if (!Array.isArray(data)) throw Error('Invalid tide predictions');
    const points=data.map(p=>({time:Date.parse(p.eventDate),height:p.value}));
    if(points.some(p=>!Number.isFinite(p.time)||!Number.isFinite(p.height))) throw Error('Incomplete tide predictions');
    points.sort((a,b)=>a.time-b.time);
    if(points.some((p,i)=>i && p.time===points[i-1].time)) throw Error('Duplicate tide predictions');
    return points;
  }
  // Compare neighbouring turning points; padded dates give both neighbours at midnight.
  function extremes(points,maxGap=Infinity) {
    const events=[];
    for(let i=1;i<points.length-1;i++) {
      let end=i;
      if(!Number.isFinite(points[i].height)) continue;
      while(end+1<points.length && points[end+1].height===points[i].height) end++;
      const left=points[i-1], right=points[end+1];
      if(right && Number.isFinite(left.height) && Number.isFinite(right.height) && points[i].time-left.time<=maxGap && right.time-points[end].time<=maxGap) {
        const type=points[i].height>left.height && points[end].height>right.height ? 'High' : points[i].height<left.height && points[end].height<right.height ? 'Low' : null;
        if(type) events.push({time:(points[i].time+points[end].time)/2,height:points[i].height,type});
      }
      i=end;
    }
    return events;
  }
  function marine(data,location) {
    const h=data?.hourly;
    if(data?.error || !weather.coordinates(data?.latitude,data?.longitude) || !h || !Array.isArray(h.time) || !Array.isArray(h.sea_level_height_msl) || h.time.length!==h.sea_level_height_msl.length || data.hourly_units?.sea_level_height_msl!=='m' || !data.timezone) throw Error('Invalid marine forecast');
    const distance=weather.distance(location,data);
    if(distance>25) return null;
    const points=h.time.map((time,i)=>({time:time*1000,height:h.sea_level_height_msl[i]}));
    if(points.some((p,i)=>!Number.isFinite(p.time) || (i && p.time<=points[i-1].time) || (p.height!==null && !Number.isFinite(p.height)))) throw Error('Invalid marine readings');
    if(points.filter(p=>Number.isFinite(p.height)).length<3) return null;
    return {points,events:extremes(points,3600000),timezone:timezone(data.timezone),source:'Open-Meteo / Meteo-France',
      sourceURL:'https://open-meteo.com/en/docs/marine-weather-api',station:`Nearby sea model · ${distance.toFixed(1)} km from ${location.name}`,
      datum:'Metres above mean sea level',model:true,note:'Estimated from hourly sea-level forecasts, including tides and weather effects. Coastal accuracy is limited; not for navigation.'};
  }
  function marineURL(location) {
    if(!weather.coordinates(location.latitude,location.longitude)) throw Error('Invalid coordinates');
    return 'https://marine-api.open-meteo.com/v1/marine?latitude='+location.latitude+'&longitude='+location.longitude+'&hourly=sea_level_height_msl&timezone=auto&timeformat=unixtime&past_days=2&forecast_days=8&cell_selection=sea';
  }
  function current(points,now) {
    const i=points.findIndex(p=>p.time>=now);
    if(i<1) return null;
    const a=points[i-1],b=points[i];
    if(!Number.isFinite(a.height)||!Number.isFinite(b.height)||b.time-a.time>3600000) return null;
    return {height:a.height+(b.height-a.height)*(now-a.time)/(b.time-a.time),trend:b.height>a.height?'Rising':b.height<a.height?'Falling':'Turning'};
  }
  const api={timezone,locationFromURL,locationURL,dayKey,dayKeys,nearestStation,predictions,extremes,marine,marineURL,current};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.GregleTides=api;
})(typeof globalThis!=='undefined'?globalThis:this);
