const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const local=require('../assets/maps-offline-routing.js');
const store=require('../assets/maps-offline-store.js');
const routing=require('../assets/maps-routing.js');
const point=p=>({lat:p[0],lng:p[1]});
function network(){
  const coords={1:[48.42,-123.37],2:[48.42,-123.36],3:[48.43,-123.36],4:[48.43,-123.37]},nodes={};
  for(const [id,p] of Object.entries(coords))nodes[id]=[...p,[],[],[false,false]];
  function edge(a,b,way,cost=100,walk=100){nodes[a][2].push([b,store.tile(...coords[b]),way,cost,walk,[coords[a],coords[b]],`Road ${way}`,'residential',[]]);}
  edge(1,2,10);edge(2,1,10);edge(2,3,20);edge(3,2,20);edge(1,4,30,150);edge(4,1,30,150);edge(4,3,40,150);edge(3,4,40,150);
  const load=async()=>nodes,keys=new Set(Object.values(coords).map(p=>store.tile(...p)));
  const options={load,keys,tile:store.tile,inside:()=>true};
  return {coords,nodes,edge,options,route:(a,b,mode='driving')=>local.route(point(a),point(b),mode,options)};
}
test('offline A* snaps inside edges and emits usable turn guidance and arrival',async()=>{
  const n=network(),r=await n.route([48.42,-123.368],[48.428,-123.36]);
  assert.equal(r.provider,'offline');assert.equal(r.traffic,false);
  assert.deepEqual(r.points[0],[48.42,-123.368]);assert.deepEqual(r.points.at(-1),[48.428,-123.36]);
  assert(r.steps.some(s=>s.modifier==='left'));assert.equal(r.steps.at(-1).type,'arrive');assert.equal(r.length,r.cumulative.at(-1));
});
test('offline router respects no-turn and only-turn relations, with a legal detour',async()=>{
  for(const rule of [[10,[20],false,false],[10,[10],true,false]]){
    const n=network();n.nodes[2][3].push(rule);
    const r=await n.route([48.42,-123.368],[48.428,-123.36]);
    assert(r.points.some(p=>p[0]===48.43&&p[1]===-123.37));
  }
});
test('driving one-way edges do not permit reverse shortcuts; walking uses pedestrian access',async()=>{
  const n=network();n.nodes[2][2].find(e=>e[0]===1)[3]=0;
  const driving=await n.route([48.42,-123.362],[48.42,-123.368]);
  assert(driving.points.length>2);const walking=await n.route([48.42,-123.362],[48.42,-123.368],'walking');assert.equal(walking.points.length,2);
});
test('barriers and region edges cannot silently become routes',async()=>{
  const n=network();n.nodes[2][4][0]=true;n.nodes[4][4][0]=true;
  await assert.rejects(n.route([48.42,-123.368],[48.428,-123.36]),/No connected/);
  const outside=network();outside.options.inside=p=>p.lat<48.425;
  await assert.rejects(outside.route([48.42,-123.368],[48.428,-123.36]),/No accessible|No connected/);
});
test('same-edge forward routing stays on the segment; remote points do not snap across kilometres',async()=>{
  const n=network(),r=await n.route([48.42,-123.368],[48.42,-123.362]);assert.equal(r.points.length,2);
  await assert.rejects(n.route([49,-123.36],n.coords[3]),/No accessible/);
});
test('offline requests and multi-stop routes never contact online providers',async()=>{
  const calls=[],offline={active:()=>true,route:async(from,to,mode)=>{calls.push({from,to,mode});return{points:[[from.lat,from.lng],[to.lat,to.lng]],cumulative:[0,100],length:100,distance:100,duration:20,steps:[],provider:'offline',traffic:false,fetchedAt:Date.now()};}};
  const service=routing.create({offline,fetch:()=>{throw Error('network must not be used');}}),from={lat:48.42,lng:-123.37},to={lat:48.43,lng:-123.36},via=[{lat:48.42,lng:-123.36}];
  const result=await service.request(from,to,'driving',{via});assert.equal(calls.length,2);assert.equal(result.provider,'offline');assert.equal(result.stops.length,1);assert.match(routing.note(result),/Offline route/);
  const controller=new AbortController();controller.abort();await assert.rejects(service.request(from,to,'driving',{signal:controller.signal}),{name:'AbortError'});
});
test('a connection failure falls back to local routing while an aborted request stays aborted',async()=>{
  let count=0;const offline={active:()=>false,route:async()=>{count++;return{provider:'offline'};}},service=routing.create({offline,fetch:async()=>{throw Error('unreachable');}});
  assert.equal((await service.request({lat:48,lng:-123},{lat:49,lng:-123})).provider,'offline');assert.equal(count,1);
});
test('generated offline shell covers required local dependencies and never prefetches provider tiles',()=>{
  const shell=fs.readFileSync(require.resolve('../assets/maps-offline-shell.js'),'utf8'),data=JSON.parse(shell.split('self.GregleMapsShell=')[1].slice(0,-2));
  for(const file of data.assets)assert(fs.existsSync(require('node:path').join(__dirname,'..',file.split('?')[0])));
  assert(data.assets.some(p=>p.includes('vendor/leaflet/leaflet.js')));assert(!data.assets.some(p=>p.startsWith('http')));
  assert.equal(fs.readFileSync(require.resolve('../gregle-sw.js'),'utf8').includes("'/calc-sw.js', '/maps-sw.js'"),true);
});
