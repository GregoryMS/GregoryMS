const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const source = pathToFileURL(path.resolve(__dirname, '../workers/esri/worker.mjs'));
const origin = 'https://maps.gregle.uk';
const secret = 'unit-test-private-esri-key';
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217]);

async function fixture(run, upstream = () => new Response(jpeg, {headers: {'Content-Type': 'image/jpeg'}})) {
  const worker = (await import(source)).default;
  const savedFetch = global.fetch, savedCaches = global.caches;
  const entries = new Map(), calls = [], pending = [], limits = [];
  global.caches = {default: {
    match: async key => entries.get(key.url)?.clone(),
    put: async (key, value) => { entries.set(key.url, value.clone()); }
  }};
  global.fetch = async (...args) => { calls.push(args); return upstream(...args); };
  const env = {ESRI_API_KEY: secret, TILE_LIMITER: {limit: async value => {limits.push(value); return {success:true};}}};
  const get = (tile='/tiles/13/1288/2833.jpg', options={}, bindings=env) => worker.fetch(new Request('https://relay.example'+tile, {headers:{Origin:origin},...options}), bindings, {waitUntil:p=>pending.push(p)});
  try { await run({get,env,calls,entries,limits,pending}); await Promise.all(pending); }
  finally { global.fetch = savedFetch; global.caches = savedCaches; }
}

test('only the upstream request contains the key, XYZ becomes Esri ZYX, and cached tiles get request-specific CORS', async()=>{
  await fixture(async h=>{
    const result=await h.get();assert.equal(result.status,200);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()),jpeg);
    const upstream=new URL(h.calls[0][0]);
    assert.equal(upstream.hostname,'ibasemaps-api.arcgis.com');assert.match(upstream.pathname,/tile\/13\/2833\/1288$/);
    assert.equal(upstream.searchParams.get('blankTile'),'false');
    assert.equal(upstream.searchParams.get('token'),secret);assert.equal(h.calls[0][1].redirect,'manual');
    assert(!JSON.stringify([...result.headers]).includes(secret));
    await Promise.all(h.pending);
    assert(![...h.entries.keys()].join('').includes(secret));
    const cached=await h.get(undefined,{headers:{Origin:'https://gregle.uk'}});
    assert.equal(cached.headers.get('Access-Control-Allow-Origin'),'https://gregle.uk');
    assert.equal(cached.headers.get('Content-Type'),'image/jpeg');
    assert.equal(h.calls.length,1);assert.equal(h.limits.length,1);
  });
});

test('invalid origins, paths, coordinates, methods, extra parameters and missing configuration never reach Esri',async()=>{
  await fixture(async h=>{
    for(const [tile,options,status] of [
      [undefined,{headers:{Origin:'https://attacker.example'}},403],
      [undefined,{headers:{}},403],['/tiles/24/0/0.jpg',{},400],['/tiles/1/2/0.jpg',{},400],
      ['/tiles/13/-1/0.jpg',{},404],['/tiles/13/0/0.jpg?url=https://attacker.example',{},404],
      [undefined,{method:'POST'},405]
    ]) assert.equal((await h.get(tile,options)).status,status);
    assert.equal((await h.get(undefined,{},{})).status,503);
    assert.equal((await h.get(undefined,{method:'OPTIONS'})).status,204);
    assert.equal(h.calls.length,0);
  });
});

test('rate limits reject before spending upstream quota',async()=>{
  await fixture(async h=>{
    h.env.TILE_LIMITER.limit=async()=>({success:false});
    const response=await h.get();assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
    assert.equal(h.calls.length,0);
  });
});

test('provider errors, redirects, JSON, fake images, oversized images and exception URLs cannot leak credentials or enter the tile cache',async()=>{
  for(const upstream of [
    ()=>new Response(secret,{status:403}),
    ()=>new Response(null,{status:302,headers:{Location:'https://attacker.example/?token='+secret}}),
    ()=>new Response(JSON.stringify({error:secret}),{headers:{'Content-Type':'application/json'}}),
    ()=>new Response(secret,{headers:{'Content-Type':'image/jpeg'}}),
    ()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'image/jpeg'}}),
    ()=>{throw Error('https://arcgis.example/?token='+secret);}
  ]) await fixture(async h=>{
    const response=await h.get();assert.equal(response.status,502);
    assert(!(await response.text()).includes(secret));assert.equal(response.headers.get('Location'),null);
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(h.entries.size,0);
  },upstream);
});


test('high-detail tile levels through 23 reach Esri with bounded coordinates',async()=>{
  await fixture(async h=>{
    for(const zoom of [20,21,22,23])assert.equal((await h.get(`/tiles/${zoom}/0/0.jpg`)).status,200);
    assert.equal(h.calls.length,4);
    assert.equal((await h.get('/tiles/23/8388608/0.jpg')).status,400);
  });
});
