((root,factory)=>{
  const api=factory(typeof module==='object'&&module.exports?require('./maps-navigation-core.js'):root.GregleNavigation,typeof module==='object'&&module.exports?require('./maps-transit-core.js'):root.GregleTransitCore);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.GregleTransitJourneyCore=api;
})(typeof window==='object'?window:globalThis,(nav,transit)=>{
  'use strict';
  const clean=v=>typeof v==='string'?v.trim().slice(0,300):'';
  const cache=new Map();let retryAt=0;
  function planURL(from,to){
    const region=transit.region(from?.lat,from?.lng);
    if(!nav.valid(from)||!nav.valid(to)||!region||region!==transit.region(to.lat,to.lng))throw Error('Transit journeys cover BC and London. Choose both locations in the same region.');
    const url=new URL('https://api.transitous.org/api/v6/plan');
    url.search=new URLSearchParams({fromPlace:`${from.lat},${from.lng}`,toPlace:`${to.lat},${to.lng}`,numItineraries:'3',transitModes:'TRANSIT',directModes:'',preTransitModes:'WALK',postTransitModes:'WALK',detailedLegs:'true',detailedTransfers:'true',useRoutedTransfers:'true',joinInterlinedLegs:'false'});
    return url.href;
  }
  const place=(p,fallback)=>{if(!p||!nav.valid({lat:p.lat,lng:p.lon}))throw Error('Invalid transit stop');return {name:clean(p.name)==='START'||clean(p.name)==='END'?fallback:clean(p.name)||fallback,lat:p.lat,lng:p.lon,id:clean(p.stopId),platform:clean(p.track||p.scheduledTrack),zone:clean(p.tz)||'UTC'};};
  function readPlan(data,from,to,now=Date.now()){
    if(!Array.isArray(data?.itineraries)||data.itineraries.length>50)throw Error('No transit journeys were returned. Try another time or nearby location.');
    const results=[];
    for(const item of data.itineraries){try{
      const start=Date.parse(item.startTime),end=Date.parse(item.endTime);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=now||end<=start||end-start>172800000||!Array.isArray(item.legs)||item.legs.length>30)continue;
      const legs=[];let totalPoints=0;
      for(const raw of item.legs){
        const mode=clean(raw.mode),walk=mode==='WALK',fromStop=place(raw.from,from.name||'Starting point'),toStop=place(raw.to,to.name||'Destination');
        if(raw.cancelled||raw.from?.cancelled||raw.to?.cancelled)throw Error('Cancelled journey');
        const a=Date.parse(raw.startTime),b=Date.parse(raw.endTime);
        if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||a<start-60000||b>end+60000)throw Error('Invalid journey times');
        if(walk&&b===a&&nav.meters(fromStop,toStop)<5)continue;
        const points=transit.decodeGeometry(raw.legGeometry);totalPoints+=points.length;if(totalPoints>30000)throw Error('Journey too large');
        const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+nav.meters({lat:points[i-1][0],lng:points[i-1][1]},{lat:points[i][0],lng:points[i][1]}));
        const length=cumulative.at(-1),distance=Number.isFinite(raw.distance)&&raw.distance>=0?raw.distance:length;
        if(!walk&&!/^(ca-bc-|gb-)/.test(clean(raw.routeId)))throw Error('Unsupported transit feed');
        const stops=Array.isArray(raw.intermediateStops)?raw.intermediateStops:[];if(stops.length>1000)throw Error('Too many stops');
        let offset=0;const steps=[];
        for(const s of (Array.isArray(raw.steps)?raw.steps:[]).slice(0,1000)){
          const direction=({LEFT:'Turn left',SLIGHTLY_LEFT:'Bear left',HARD_LEFT:'Turn sharp left',RIGHT:'Turn right',SLIGHTLY_RIGHT:'Bear right',HARD_RIGHT:'Turn sharp right',UTURN_LEFT:'Turn around',UTURN_RIGHT:'Turn around',ELEVATOR:'Take the lift',DEPART:'Start walking',CONTINUE:'Continue'})[s.relativeDirection]||'Continue';
          const d=Number.isFinite(s.distance)&&s.distance>=0?s.distance:0;steps.push({text:`${direction}${clean(s.streetName)?' on '+clean(s.streetName):''}`,start:distance?Math.min(length,offset/distance*length):0,distance:d});offset+=d;
        }
        steps.push({text:`Arrive at ${toStop.name}`,start:length,distance:0});
        const alerts=(Array.isArray(raw.alerts)?raw.alerts:[]).map(x=>clean(x.descriptionText||x.headerText)).filter(Boolean).slice(0,3);
        legs.push({mode,walk,from:fromStop,to:toStop,start:a,end:b,live:raw.realTime===true,scheduledStart:Date.parse(raw.scheduledStartTime)||a,scheduledEnd:Date.parse(raw.scheduledEndTime)||b,route:clean(raw.displayName||raw.routeShortName)||mode,routeId:clean(raw.routeId),headsign:clean(raw.headsign)||toStop.name,tripId:clean(raw.tripId),interline:raw.interlineWithPreviousLeg===true,stops:stops.map(s=>place(s,'Stop')),points,cumulative,length,distance,duration:(b-a)/1000,steps,alerts});
      }
      if(!legs.length||!legs.some(l=>!l.walk))continue;
      legs.forEach((leg,i)=>leg.stayOnBoard=legs[i+1]?.interline===true);
      // A stay-seated continuation does not count as a transfer.
      const rides=legs.filter(l=>!l.walk),transfers=Math.max(0,rides.filter(l=>!l.interline).length-1);
      results.push({transit:true,start,end,duration:(end-start)/1000,transfers,legs,points:legs.flatMap(l=>l.points),distance:legs.reduce((n,l)=>n+l.distance,0),walkDistance:legs.filter(l=>l.walk).reduce((n,l)=>n+l.distance,0),zone:rides[0].from.zone,live:rides.some(l=>l.live)});
      if(results.length===3)break;
    }catch{ /* Keep another valid option if one itinerary is malformed/cancelled. */ }}
    if(!results.length)throw Error('No usable transit journey was found. Try nearby stops or refresh later.');return results;
  }
  async function request(from,to,{signal}={}){
    const url=planURL(from,to),key=url+'|'+Math.floor(Date.now()/60000),saved=cache.get(key);
    if(saved&&Date.now()-saved.at<60000)return saved.routes;
    if(Date.now()<retryAt)throw Error('Transit planning is temporarily unavailable. Please wait a minute before retrying.');
    const response=await fetch(url,{signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
    if(!response.ok){const raw=response.headers.get('Retry-After'),seconds=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw||'')-Date.now())/1000);retryAt=Date.now()+Math.min(3600000,Math.max(60000,seconds*1000||60000));throw Error('Transit planning is temporarily unavailable. Please retry shortly.');}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw Error('Transit response too large');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const routes=readPlan(JSON.parse(new TextDecoder().decode(bytes)),from,to);if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    cache.set(key,{routes,at:Date.now()});while(cache.size>5)cache.delete(cache.keys().next().value);return routes;
  }
  function clock(time,zone){try{return new Date(time).toLocaleTimeString(undefined,{timeZone:zone,hour:'2-digit',minute:'2-digit',timeZoneName:'short'});}catch{return new Date(time).toISOString().slice(11,16)+' UTC';}}
  function stepText(leg){return leg.walk?`Walk ${nav.distance(leg.distance)} to ${leg.to.name}`:`${leg.interline?'Stay aboard':'Board'} ${leg.route} toward ${leg.headsign}${leg.from.platform?' · platform '+leg.from.platform:''} at ${leg.from.name}, ${clock(leg.start,leg.from.zone)}. ${leg.stayOnBoard?'Stay aboard at':'Get off at'} ${leg.to.name}, ${clock(leg.end,leg.to.zone)} (${leg.live?'live estimate':'scheduled'}).`;}
  function guidance(leg,fix,previous=null,now=Date.now()){
    const point={lat:fix?.coords?.latitude,lng:fix?.coords?.longitude},accuracy=fix?.coords?.accuracy,stamp=fix?.timestamp;
    if(!nav.valid(point)||!Number.isFinite(accuracy)||accuracy<0||accuracy>80||!Number.isFinite(stamp)||stamp<now-20000||stamp>now+5000)return {reliable:false};
    const progress=nav.progress(leg,point,previous,leg.walk?'walking':'driving');if(!progress||progress.away>(leg.walk?70:120))return {reliable:false};
    if(!previous&&!leg.walk&&nav.meters(point,leg.from)<250&&progress.along>Math.min(1500,leg.length*.5))return {reliable:false};
    if(previous&&Math.abs(progress.along-previous.along)>Math.max(300,(stamp-previous.stamp)/1000*65+150))return {reliable:false};
    const remaining=Math.max(0,leg.length-progress.along),ratio=leg.length?progress.along/leg.length:0;
    return {...progress,reliable:true,stamp,remaining,getOffSoon:!leg.walk&&ratio>=.5&&remaining<=(['SUBWAY','RAIL','SUBURBAN','TRAM','METRO'].includes(leg.mode)?1200:700),atEnd:ratio>=.9&&nav.meters(point,leg.to)<(leg.walk?45:110)};
  }
  return {planURL,readPlan,request,clock,stepText,guidance};
});
