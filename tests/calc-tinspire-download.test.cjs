const {test}=require('node:test');
const assert=require('node:assert/strict');
const worker=import('../workers/nspire-firmware/worker.mjs');
test('firmware relay streams only the two fixed files without forwarding browser credentials',async()=>{
  const {firmware,FILES}=await worker;
  for (const path of ['/boot1','/flash']) {
    let call;
    const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.close();}});
    const response=await firmware(new Request('https://firmware.example'+path,{headers:{Cookie:'private',Authorization:'private'}}),async(url,options)=>{
      call={url,options};return new Response(stream,{headers:{'Content-Length':String(FILES[path].size),'Set-Cookie':'private'}});
    });
    assert.equal(response.status,200);assert.equal(call.url,FILES[path].url);
    assert.equal(call.options.redirect,'manual');assert.equal(call.options.headers.Cookie,undefined);assert.equal(call.options.headers.Authorization,undefined);
    assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]),'response streams without a full firmware allocation in the relay');
  }
});
test('relay rejects arbitrary sources, methods, redirects and changed sizes',async()=>{
  const {firmware}=await worker; let calls=0;
  const fetcher=async()=>{calls++;throw Error('must not run');};
  for (const [path,method,status] of [['/other','GET',404],['/flash?url=https://example.com','GET',400],['/boot1','POST',405],['/flash','HEAD',200]]) {
    assert.equal((await firmware(new Request('https://firmware.example'+path,{method}),fetcher)).status,status);
  }
  assert.equal(calls,0);
  for (const response of [new Response(null,{status:302}),new Response('bad',{headers:{'Content-Length':'3'}})]) {
    assert.equal((await firmware(new Request('https://firmware.example/boot1'),async()=>response)).status,502);
  }
});
test('browser loader rejects incomplete and fingerprint-mismatched downloads before saving firmware',async()=>{
  const {downloadRom,FILES}=await import('../assets/tinspire/rom-source.mjs');
  const original=global.fetch;
  try {
    let options;
    global.fetch=async(url,settings)=>{options=settings;return new Response(new Uint8Array(8),{headers:{'Content-Length':String(FILES[0].size)}});};
    await assert.rejects(downloadRom(),/incomplete/);
    assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
    global.fetch=async()=>new Response(new Uint8Array(FILES[0].size));
    await assert.rejects(downloadRom(),/fingerprint/);
  } finally {global.fetch=original;}
});
