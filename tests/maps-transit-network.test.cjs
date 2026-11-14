const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../assets/maps-transit-network-core.js');
const index=city=>JSON.parse(fs.readFileSync(`${__dirname}/../data/transit/${city}/index.json`,'utf8'));

test('official regional route indexes validate every geometry, stop reference and operator route ID',()=>{
  for(const city of ['victoria','vancouver']){
    const data=core.readIndex(index(city),city),stops=new Set(data.stops.map(s=>s.key));
    assert(data.routes.length>60);
    for(const route of data.routes){
      const path=`${__dirname}/../data/transit/${city}/${route.file}`,detail=core.readRoute(JSON.parse(fs.readFileSync(path,'utf8')));
      assert.equal(detail.routeId,route.routeId);
      assert(detail.variants.every(v=>v.stops.every(s=>stops.has(s))));
    }
  }
  const rapid=index('vancouver').rapid.map(r=>r.name);
  for(const name of ['Expo Line','Millennium Line','Canada Line','SeaBus','West Coast Express'])assert(rapid.includes(name));
  assert(index('victoria').rapid.some(r=>r.number==='95'));
});

test('number lookup prioritizes exact matches, ignores unrelated short stop codes and searches station names',()=>{
  const data=index('vancouver');
  assert.equal(core.search(data,'099').routes[0].number,'99');
  assert.equal(core.search(data,'99').stops.length,0);
  assert(core.search(data,'waterfront').stops.some(s=>/Waterfront Station/.test(s.name)));
  assert(core.search(index('victoria'),'95').routes.some(r=>r.rapid));
  assert.equal(core.cityAt(48.42,-123.36),'victoria');assert.equal(core.cityAt(49.28,-123.12),'vancouver');assert.equal(core.cityAt(51.5,-.12),undefined);
});

test('screen-space decluttering leaves room between markers without merging boarding stop identities',()=>{
  const items=Array.from({length:100},(_,i)=>({id:i,x:i*2,y:0})),show=core.spaced(items,p=>p,20,8);
  assert.equal(show.length,8);assert.equal(show[0].id,0);
  for(let i=1;i<show.length;i++)assert(show[i].x-show[i-1].x>=20);
});

test('invalid route shapes, unsafe file names and out-of-region coordinates are rejected',()=>{
  const data=index('victoria');
  data.routes[0].file='../other.json';assert.throws(()=>core.readIndex(data,'victoria'));
  const route=structuredClone(index('vancouver').rapid[0]);route.variants[0].points[0]=[0,0];assert.throws(()=>core.readRoute(route));
});

test('coastal BC areas cover the Island, Fraser Valley and Sea to Sky with complete route geometry',()=>{
 const systems=core.readRegions(JSON.parse(fs.readFileSync(`${__dirname}/../data/transit/regions.json`,'utf8')));
 assert.equal(systems.length,14);assert(systems.every(s=>['Vancouver Island','Lower Mainland','Sea to Sky'].includes(s.group)));
 let total=0;
 for(const system of systems){const data=core.readIndex(index(system.city),system.city),stops=new Set(data.stops.map(s=>s.key));total+=data.routes.length;
  for(const route of data.routes){const detail=core.readRoute(JSON.parse(fs.readFileSync(`${__dirname}/../data/transit/${system.city}/${route.file}`,'utf8')));assert(detail.variants.every(v=>v.stops.every(s=>stops.has(s))));}
 }
 assert(total>350);
 for(const [lat,lng,city] of [[49.165,-123.94,'nanaimo'],[49.686,-124.994,'comox'],[50.024,-125.244,'campbell-river'],[50.644,-127.462,'mount-waddington'],[50.117,-122.955,'whistler'],[49.701,-123.155,'squamish']])assert.equal(core.cityAt(lat,lng,systems),city);
 assert(core.inView([-124,48.3,-123.25,49],systems).length>1,'overlapping regional feeds must load together');
 assert(!systems.some(s=>s.city==='kamloops'||s.city==='kelowna'));
});

test('small-system stop boards display published schedules and page without claiming live data',()=>{
 const transit=require('../assets/maps-transit-core.js');
 for(const city of ['salt-spring','west-coast','mount-waddington','pemberton']){
  const data=index(city),stop=data.stops.find(s=>s.boardFile),board=JSON.parse(fs.readFileSync(`${__dirname}/../${stop.boardFile}`,'utf8'));
  assert(board.departures.length);const time=new Date(board.departures[0][0]).toISOString(),first=transit.readLocalDepartures(board,stop,time);
  assert(first.published);assert(first.rows.length);assert(first.rows.every(r=>r.live===false&&r.routeId.startsWith('ca-bc-')));
  assert(transit.departuresURL(stop,time).startsWith(stop.boardFile+'?'));
  if(first.next){const next=transit.readLocalDepartures(board,stop,time,first.next);assert(next.rows[0].time>=first.rows.at(-1).time);}
  assert.throws(()=>transit.readLocalDepartures({...board,stopId:'other'},stop,time));
 }
});
