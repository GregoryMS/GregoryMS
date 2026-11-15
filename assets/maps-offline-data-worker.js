/* Bounded map decoding, rendering preparation and name search, away from UI. */
'use strict';
importScripts('maps-offline-store.js');
const store=self.GregleOfflineStore,queue=new Map(),latest=new Map();
let busy=false;
self.onmessage=event=>{const job=event.data;latest.set(job.type,job.id);queue.set(job.type,job);pump();};
async function pump(){
  if(busy)return;busy=true;
  try{while(queue.size){
    const type=queue.has('search')?'search':queue.keys().next().value,job=queue.get(type);queue.delete(type);
    const check=()=>{if(latest.get(type)!==job.id)throw new DOMException('Superseded','AbortError');};
    try{const pack=await store.get(job.packKey);if(!pack)throw Error('The downloaded map is unavailable.');
      const result=type==='search'?await search(pack,job,check):await render(pack,job,check);check();self.postMessage({id:job.id,result});
    }catch(e){if(latest.get(type)===job.id)self.postMessage({id:job.id,error:e.message});}
  }}finally{busy=false;}
}
const inBounds=(p,b)=>p[1]>=b[0]&&p[1]<=b[2]&&p[0]>=b[1]&&p[0]<=b[3];
function visible(coords,b){let west=180,east=-180,south=90,north=-90;for(const p of coords){west=Math.min(west,p[1]);east=Math.max(east,p[1]);south=Math.min(south,p[0]);north=Math.max(north,p[0]);}return west<=b[2]&&east>=b[0]&&south<=b[3]&&north>=b[1];}
function simplify(points,zoom,polygon){
  const tolerance=360/(256*2**zoom)*.8,scale=Math.cos(points[0][0]*Math.PI/180),result=[points[0]];
  for(let i=1;i<points.length-1;i++){const a=result.at(-1),b=points[i];if(Math.hypot((a[1]-b[1])*scale,a[0]-b[0])>=tolerance)result.push(b);}
  result.push(points.at(-1));return polygon&&result.length<4?[points[0],points[1],points[2],points[0]]:result;
}
async function render(pack,job,check){
  const {bounds,zoom,keys}=job,features=[];
  // Bound retained geometry, including for a province-wide view on an iPhone.
  const budgets={major:[4000,50000],road:[2000,30000],path:[500,5000],background:[500,15000],place:[1000,1000]};
  let truncated=false;
  for(const key of keys){check();await store.eachFeature(pack,key,feature=>{
    const [kind,name,coords,polygon]=feature;
    if(key==='overview'&&keys.length>1&&kind!=='place')return;
    if(kind==='place'){if(inBounds(coords,bounds)&&budgets.place[0]-->0)features.push(feature);return;}
    if(!visible(coords,bounds))return;
    const major=['motorway','trunk','primary','secondary','tertiary','ferry'].includes(kind),background=polygon||['water','river','stream','coastline','riverbank'].includes(kind),path=['footway','path','steps','cycleway','bridleway'].includes(kind);
    if(zoom<13&&!major&&!background)return;
    if(zoom<10&&['secondary','tertiary'].includes(kind))return;
    const group=budgets[background?'background':major?'major':path?'path':'road'];
    const points=simplify(coords,zoom,polygon);
    if(group[0]<=0||group[1]<points.length){truncated=true;return;}
    group[0]--;group[1]-=points.length;features.push([kind,name,points,polygon]);
  },check);}
  // Draw filled land/water behind the road network regardless of source order.
  features.sort((a,b)=>Number(b[3])-Number(a[3]));
  return {features,truncated};
}
async function search(pack,job,check){
  const matches=[],seen=new Set(),query=job.term.trim().toLocaleLowerCase(),center=job.center;
  const x=Math.floor(center.lng*4),y=Math.floor(center.lat*4),keys=['overview',...Object.keys(pack.index.entries).filter(k=>k!=='overview'&&Math.abs(Number(k.split('_')[0])-x)<=1&&Math.abs(Number(k.split('_')[1])-y)<=1)];
  keys.sort((a,b)=>Number(b===store.tile(center.lat,center.lng))-Number(a===store.tile(center.lat,center.lng)));
  for(const key of keys){check();await store.eachFeature(pack,key,([kind,name,geometry])=>{
    if(!name||!name.toLocaleLowerCase().includes(query)||seen.has(name))return;
    const p=kind==='place'?geometry:geometry[Math.floor(geometry.length/2)];if(!store.inside({lat:p[0],lng:p[1]},pack.bounds))return;
    seen.add(name);matches.push({lat:p[0],lng:p[1],name,detail:`Downloaded ${pack.name} · ${kind==='place'?'place':'road'}`,zoom:kind==='place'?13:16});
    if(matches.length>=30)return false;
  },check);if(matches.length>=30)break;}
  const distance=p=>Math.hypot((p.lng-center.lng)*Math.cos(center.lat*Math.PI/180),p.lat-center.lat);
  return matches.sort((a,b)=>distance(a)-distance(b)).slice(0,8);
}
