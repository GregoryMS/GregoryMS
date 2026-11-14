((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleTransitNetworkCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const regions = {victoria:[-124.6,48.25,-123.05,48.9], vancouver:[-123.6,48.95,-121.8,49.65]};
  const cityAt = (lat,lng) => Object.keys(regions).find(city => { const [w,s,e,n]=regions[city]; return lat>=s&&lat<=n&&lng>=w&&lng<=e; });
  const text = value => typeof value === 'string' && value.length <= 400;
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0]>=48&&point[0]<=51&&point[1]>=-125&&point[1]<=-120;
  const validRoute = route => route && text(route.id)&&text(route.routeId)&&text(route.number)&&text(route.name)&&['BUS','RAIL','SUBWAY','TRAM','FERRY'].includes(route.mode)&&/^#[a-f\d]{6}$/i.test(route.color);
  function readRoute(data) {
    if (!validRoute(data)||!Array.isArray(data.variants)||!data.variants.length||data.variants.length>250) throw Error('Invalid route');
    let points=0;
    for (const variant of data.variants) {
      if(!text(variant.headsign)||!text(variant.direction)||!Array.isArray(variant.points)||variant.points.length<2||!variant.points.every(validPoint)||!Array.isArray(variant.stops)||!variant.stops.every(text)||variant.stops.length>1000)throw Error('Invalid route variant');
      points+=variant.points.length;
    }
    if(points>150000)throw Error('Route too large');
    return data;
  }
  function readIndex(data, city) {
    if(data?.schema!==1||data.city!==city||!text(data.updated)||!Array.isArray(data.routes)||data.routes.length>1000||!Array.isArray(data.stops)||data.stops.length>20000||!Array.isArray(data.rapid)||data.rapid.length>100)throw Error('Invalid transit network');
    for(const route of data.routes)if(!validRoute(route)||!/^\w{16}\.json$/.test(route.file))throw Error('Invalid route index');
    for(const stop of data.stops)if(!text(stop.id)||!text(stop.key)||!text(stop.name)||!validPoint([stop.lat,stop.lng])||!Array.isArray(stop.modes)||!stop.modes.every(text)||!Array.isArray(stop.routes)||!stop.routes.every(text))throw Error('Invalid station');
    data.rapid.forEach(readRoute);
    return data;
  }
  function search(data, query) {
    const q=query.trim().toLocaleLowerCase(), number=value=>String(value).toLocaleLowerCase().replace(/^0+(?=\d)/,'');
    const matches=route=>!q||`${route.number} ${route.name}`.toLocaleLowerCase().includes(q)||number(route.number)===number(q);
    const routes=data.routes.filter(matches).sort((a,b)=>Number(number(b.number)===number(q))-Number(number(a.number)===number(q))||Number(b.rapid)-Number(a.rapid)||a.number.localeCompare(b.number,undefined,{numeric:true}));
    const seen=new Set();
    const stops=q.length>=2?data.stops.filter(stop=>(/^\d+$/.test(q)?q.length>=4&&stop.code?.startsWith(q):stop.name.toLocaleLowerCase().includes(q))&&!seen.has(stop.parent||stop.id)&&seen.add(stop.parent||stop.id)).slice(0,30):[];
    return {routes,stops};
  }
  // Screen-space spacing keeps the same geographic density on phones/desktops.
  function spaced(items, project, gap, limit=180) {
    const cells=new Map(), result=[];
    for(const item of items) {
      const p=project(item),x=Math.floor(p.x/gap),y=Math.floor(p.y/gap);
      let crowded=false;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if((cells.get(`${x+dx}:${y+dy}`)||[]).some(other=>Math.hypot(p.x-other.x,p.y-other.y)<gap))crowded=true;
      if(crowded)continue;
      const key=`${x}:${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);result.push(item);
      if(result.length>=limit)break;
    }
    return result;
  }
  return {cityAt,readIndex,readRoute,search,spaced};
});
