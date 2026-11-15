/* A* over directed road edges, with node-via turn restrictions and bounded shards. */
((root, factory) => {
  const api = factory(typeof module === 'object' && module.exports ? require('./maps-navigation-core.js') : root.GregleNavigation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleOfflineRouting = api;
})(globalThis, core => {
  'use strict';
  class Heap {
    items = [];
    push(item) { let i = this.items.length; this.items.push(item); while (i) {const p = (i-1)>>1;if(this.items[p].priority <= item.priority)break;this.items[i] = this.items[p];i=p;} this.items[i]=item; }
    pop() {const first=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].priority<this.items[c].priority)c++;if(this.items[c].priority>=last.priority)break;this.items[i]=this.items[c];i=c;}this.items[i]=last;}return first;}
    get length() {return this.items.length;}
  }
  const point = p => ({lat:p[0],lng:p[1]});
  const meters = (a,b) => core.meters(point(a), point(b));
  const lengths = points => {const d=[0];for(let i=1;i<points.length;i++)d.push(d.at(-1)+meters(points[i-1],points[i]));return d;};
  function project(p, geometry) {
    const d=lengths(geometry), scale=Math.cos(p.lat*Math.PI/180), lng=p.lng,lat=p.lat;
    let best;
    for(let i=1;i<geometry.length;i++){
      const a=geometry[i-1],b=geometry[i],ax=(a[1]-lng)*scale,ay=a[0]-lat,dx=(b[1]-a[1])*scale,dy=b[0]-a[0];
      const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),q=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      const away=core.meters(p,point(q)),along=d[i-1]+(d[i]-d[i-1])*t;
      if(!best||away<best.away)best={away,along,total:d.at(-1),q,index:i,t};
    }
    return best;
  }
  function allowed(node, incoming, previous, edge, profile) {
    if (!edge[profile+3] || node[4]?.[profile]) return false;
    if (profile === 1 || incoming == null) return true;
    // The arriving way may prohibit entry to a complex via-way sequence.
    if (node[2].some(e=>e[2]===incoming && e[8]?.includes(edge[2]))) return false;
    return !(node[3] || []).some(([from, to, only, uturn]) => from === incoming && (uturn ? to.includes(edge[2]) && edge[0] === previous : only ? !to.includes(edge[2]) : to.includes(edge[2])));
  }
  function clipped(edge, snap, tail) {
    const result = [...edge];
    result[5] = tail ? [snap.q,...edge[5].slice(snap.index)] : [...edge[5].slice(0,snap.index),snap.q];
    const ratio = snap.total ? (tail ? 1-snap.along/snap.total : snap.along/snap.total) : 0;
    result[3] *= ratio; result[4] *= ratio;
    return result;
  }
  async function route(from, to, mode, {load, keys, tile, inside, check = () => {}, snapTolerance = 3}) {
    if(!core.valid(from)||!core.valid(to)||!['driving','walking'].includes(mode))throw Error('Choose two valid locations and driving or walking.');
    const profile=mode==='walking'?1:0,costIndex=profile+3;
    async function snap(p) {
      const [x,y]=tile(p.lat,p.lng).split('_').map(Number), candidates=[];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        const key=`${x+dx}_${y+dy}`;if(!keys.has(key))continue;
        const nodes=await load(key);check();
        for(const [id,node] of Object.entries(nodes||{}))for(const edge of node[2]){
          if(!edge[costIndex]||node[4]?.[profile])continue;
          const s=project(p,edge[5]);
          if(s.away<=(profile?150:250)&&inside(point(s.q)))candidates.push({id:Number(id),key,edge,...s});
        }
      }
      if(!candidates.length)throw Error('No accessible downloaded road near this point. Try a pin closer to a road in your saved region.');
      candidates.sort((a,b)=>a.away-b.away);
      // Start with the closest physical road. A disconnected driveway can
      // retry nearby roads; snap distance is heavily penalised in that retry.
      return candidates.filter(s=>s.away<=candidates[0].away+snapTolerance).slice(0,snapTolerance===3?12:250);
    }
    const starts=await snap(from),ends=await snap(to),queue=new Heap(),best=new Map();
    let goal=null,visited=0;
    const heuristic = p => Math.max(0,core.meters(point(p),to)-Math.max(...ends.map(e=>e.away)))/(profile?20/3.6:130/3.6);
    function offer(item) {const key=`${item.node}|${item.way}|${item.prev}`;if(item.cost>=(best.get(key)??Infinity))return;best.set(key,item.cost);queue.push({...item,key,priority:item.cost+heuristic(item.position)});}
    for(const s of starts){
      const edge=clipped(s.edge,s,true);
      if(!edge[5].every(p=>inside(point(p))))continue;
      offer({node:edge[0],shard:edge[1],way:edge[2],prev:s.id,cost:edge[costIndex]+s.away*5,position:edge[5].at(-1),parent:null,edge});
      for(const e of ends)if(s.id===e.id&&s.edge[0]===e.edge[0]&&s.edge[2]===e.edge[2]&&s.along<=e.along){
        const direct=clipped(s.edge,s,true),last=e.index-s.index+1;
        direct[5]=[s.q,...s.edge[5].slice(s.index,e.index),e.q];
        direct[costIndex]=s.edge[costIndex]*(e.along-s.along)/(s.total||1);
        const cost=direct[costIndex]+s.away*5+e.away*5;
        if(!goal||cost<goal.cost)goal={cost,edge:direct,parent:null};
      }
    }
    while(queue.length){
      check();const current=queue.pop();
      if(current.cost!==best.get(current.key))continue;
      if(goal&&current.priority>=goal.cost)break;
      if(++visited>500000)throw Error('This offline route is too large for this device. Try a closer stop.');
      const node=(await load(current.shard))?.[current.node];if(!node)continue;
      for(const end of ends)if(end.id===current.node&&allowed(node,current.way,current.prev,end.edge,profile)){
        const edge=clipped(end.edge,end,false),cost=current.cost+edge[costIndex]+end.away*5;
        if(edge[5].every(p=>inside(point(p)))&&(!goal||cost<goal.cost))goal={cost,parent:current,edge};
      }
      for(const edge of node[2]){
        if(!keys.has(edge[1])||!allowed(node,current.way,current.prev,edge,profile)||!edge[5].every(p=>inside(point(p))))continue;
        offer({node:edge[0],shard:edge[1],way:edge[2],prev:current.node,cost:current.cost+edge[costIndex],position:edge[5].at(-1),parent:current,edge});
      }
      if(visited%250===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!goal&&snapTolerance===3)return route(from,to,mode,{load,keys,tile,inside,check,snapTolerance:100});
    if(!goal)throw Error('No connected offline route inside this downloaded region. Download a larger region or choose closer points.');
    const edges=[];for(let cursor=goal;cursor;cursor=cursor.parent)edges.push(cursor.edge);edges.reverse();
    const geometry=[],steps=[];let total=0,elapsed=0;
    function bearing(a,b){return Math.atan2((b[1]-a[1])*Math.cos(a[0]*Math.PI/180),b[0]-a[0])*180/Math.PI;}
    edges.forEach((edge,i)=>{
      const coords=edge[5],length=lengths(coords).at(-1),previous=edges[i-1],name=edge[6];
      const angle=previous?(bearing(coords[0],coords.find(p=>meters(coords[0],p)>0.1)||coords.at(-1))-bearing([...previous[5]].reverse().find(p=>meters(previous[5].at(-1),p)>0.1)||previous[5][0],previous[5].at(-1))+540)%360-180:0;
      if(!i||!(edge[7]==='roundabout'&&previous[7]==='roundabout')&&(name!==previous[6]||Math.abs(angle)>35||edge[7]==='roundabout'||previous[7]==='roundabout')){
        const modifier=Math.abs(angle)>155?'uturn':Math.abs(angle)<25?'straight':angle>0?'right':'left';
        const text=edge[7]==='ferry'&&previous?.[7]!=='ferry'?`Take the ferry${name?' · '+name:''}`:!i?`Start${name?' on '+name:''}`:edge[7]==='roundabout'?'Enter the roundabout':previous[7]==='roundabout'?`Exit the roundabout${name?' onto '+name:''}`:`${modifier==='straight'?'Continue':modifier==='uturn'?'Make a U-turn':'Turn '+modifier}${name?' onto '+name:''}`;
        steps.push({text,start:total,distance:0,type:!i?'depart':'turn',modifier});
      }
      coords.forEach(p=>{if(!geometry.length||meters(geometry.at(-1),p)>0.01)geometry.push(p);});
      total+=length;elapsed+=edge[costIndex];
    });
    if(geometry.length<2)throw Error('These points are already at the same location.');
    const cumulative=lengths(geometry);total=cumulative.at(-1);
    steps.push({text:core.meters(to,point(geometry.at(-1)))>50?'Arrive near your destination':'Arrive at your destination',start:total,distance:0,type:'arrive',modifier:''});
    steps.forEach((s,i)=>s.distance=(steps[i+1]?.start??total)-s.start);
    return {endSnap:core.meters(to,point(geometry.at(-1))),points:geometry,cumulative,length:total,distance:total,duration:elapsed,steps,provider:'offline',traffic:false,fetchedAt:Date.now()};
  }
  return {Heap, project, allowed, route};
});
