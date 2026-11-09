((root,factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GregleTransitRoads=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  function distance(point,a,b){
    const x=(point[1]-a[1])*111320*Math.cos(point[0]*Math.PI/180),y=(point[0]-a[0])*111320,dx=(b[1]-a[1])*111320*Math.cos(point[0]*Math.PI/180),dy=(b[0]-a[0])*111320;
    const t=dx||dy?Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy))):0;return Math.hypot(x-t*dx,y-t*dy);
  }
  function simplify(points,tolerance){
    const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const [a,b]=stack.pop();let max=tolerance,index=-1;for(let i=a+1;i<b;i++){const d=distance(points[i],points[a],points[b]);if(d>max){max=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  }
  function trace(points){
    if(!Array.isArray(points)||points.length<2||points.length>2000)return null;
    for(const tolerance of [5,10,20,35]){const result=simplify(points,tolerance);if(result.length<=100)return result;}
    return null;
  }
  const length=points=>points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i],points[i]),0);
  const near=(p,line)=>line.slice(1).some((b,i)=>distance(p,line[i],b)<=80);
  function readMatch(data,original,input){
    const match=data?.matchings?.[0],coords=match?.geometry?.coordinates;
    if(data?.code!=='Ok'||data.matchings.length!==1||!(match.confidence>=.7)||match.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length<2||coords.length>10000||!Array.isArray(data.tracepoints)||data.tracepoints.length!==input.length||data.tracepoints.filter(p=>p&&p.matchings_index===0).length<input.length*.95)throw Error('Incomplete road match');
    const points=coords.map(p=>{if(!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)throw Error('Invalid matched point');return [p[1],p[0]];});
    const ratio=length(points)/length(original);
    // Reject shortcuts, detours and other roads that leave the published trace.
    if(!Number.isFinite(ratio)||ratio<.75||ratio>1.35||!original.every(p=>near(p,points))||!points.every(p=>near(p,original)))throw Error('Road match left bus corridor');
    return points;
  }
  async function match(data,{signal}={}){
    if(!['BUS','COACH'].includes(data.mode))return data;
    const input=trace(data.points);if(!input)return data;
    try{
      const response=await fetch('https://gregle-mapbox.square-rain-5ded.workers.dev/match',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:input.map(([lat,lng])=>({lat,lng}))}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)].filter(Boolean))});
      if(!response.ok)return data;
      const points=readMatch(await response.json(),data.points,input);if(signal?.aborted)return data;
      return {...data,points,roadMatched:true};
    }catch{return data;}
  }
  return {trace,readMatch,match};
});
