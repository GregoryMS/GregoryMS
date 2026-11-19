const {test}=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../workers/canadian-radar/worker.mjs');
const now=Date.parse('2026-11-19T20:00:00Z');
const link=(station,code,suffix='')=>`<a href="${code}_MSC_Radar-DPQPE_${station}_Rain${suffix}.gif">scan</a>`;
test('Canadian index parser excludes contingency mosaics, other stations, invalid and stale scans',async()=>{
  const {scansFrom,scanTime}=await modulePromise;
  const html=link('CASAG','20261119T2000Z')+link('CASAG','20261119T1954Z')+link('CASAG','20261119T2000Z','-Contingency')+link('CASHP','20261119T1948Z')+link('CASAG','20261119T1600Z')+link('CASAG','20261119T2500Z');
  assert.deepEqual(scansFrom(html,'CASAG',now).map(f=>f.code),['20261119T1954Z','20261119T2000Z']);
  assert.ok(Number.isNaN(scanTime('20260230T1200Z')));
});
test('proxy only exposes the two supported stations, recent images and safe request methods',async()=>{
  const {handle}=await modulePromise;let calls=0;
  const fetcher=async()=>{calls++;throw Error('Unexpected upstream request');};
  for(const path of ['/stations/KATX/frames','/stations/CASXX/frames','/stations/CASAG/images/20261118T0000Z.gif','/stations/CASAG/images/20261119T2000Z.gif?url=https://evil.test','/https://evil.test']) {
    const response=await handle(new Request('https://radar.test'+path),{now,fetcher});assert.ok(response.status>=400);
  }
  assert.equal((await handle(new Request('https://radar.test/stations/CASAG/frames',{method:'POST'}),{now,fetcher})).status,405);
  assert.equal(calls,0);
});
test('midnight history includes yesterday and image requests resolve to its dated archive',async()=>{
  const {handle,upstreamPath}=await modulePromise,midnight=Date.parse('2026-11-20T00:06:00Z'),urls=[];
  const response=await handle(new Request('https://radar.test/stations/CASHP/frames'),{now:midnight,fetcher:async url=>{
    urls.push(url);return new Response(url.includes('/today/')?link('CASHP','20261120T0006Z'):link('CASHP','20261119T2354Z'));
  }});
  assert.equal(response.status,200);assert.equal((await response.json()).frames.length,2);
  assert.match(urls[1],/20261119\/WXO-DD/);
  assert.match(upstreamPath('CASHP','20261119T2354Z',midnight),/20261119\/WXO-DD/);
});
test('successful station images are GIF-validated, CORS-enabled and cached',async()=>{
  const {handle}=await modulePromise;const writes=[],pending=[];
  const response=await handle(new Request('https://radar.test/stations/CASAG/images/20261119T2000Z.gif'),{
    now,fetcher:async()=>new Response(new TextEncoder().encode('GIF89aexample')),
    cache:{match:async()=>undefined,put:async(key,value)=>writes.push({key,value})},ctx:{waitUntil:p=>pending.push(p)}
  });
  await Promise.all(pending);assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(response.headers.get('Content-Type'),'image/gif');assert.equal(writes.length,1);
});
test('cache hits avoid upstream access; redirects and oversized directory bodies fail explicitly',async()=>{
  const {handle}=await modulePromise;
  const cached=new Response('cached');
  assert.equal(await handle(new Request('https://radar.test/stations/CASAG/frames'),{now,cache:{match:async()=>cached},fetcher:()=>{throw Error('Should not fetch');}}),cached);
  for(const upstream of [new Response('',{status:302,headers:{Location:'https://evil.test'}}),new Response('x',{headers:{'Content-Length':'2000000'}})]) {
    const result=await handle(new Request('https://radar.test/stations/CASAG/frames'),{now,fetcher:async()=>upstream});assert.equal(result.status,502);
  }
});
