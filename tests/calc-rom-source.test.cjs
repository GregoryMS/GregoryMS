const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=()=>import(pathToFileURL(path.join(__dirname,'../assets/ti84/rom-source.mjs')));

test('hosted ROM requests use CORS without cookies or a referrer, and reject unavailable files',async t => {
  const {downloadRom,ROM_SOURCE}=await source();
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(url,ROM_SOURCE); assert.equal(options.mode,'cors');
    assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer');
    return new Response('Unavailable',{status:503});
  });
  await assert.rejects(downloadRom(),/unavailable/);
});
test('hosted ROM validation rejects unexpected file sizes before booting',async t => {
  const {downloadRom,ROM_BYTES}=await source();
  t.mock.method(globalThis,'fetch',async () => new Response(new Uint8Array(1),{headers:{'content-length':String(ROM_BYTES+1)}}));
  await assert.rejects(downloadRom(),/has changed/);
});
test('truncated hosted downloads are rejected rather than cached',async t => {
  const {downloadRom}=await source();
  t.mock.method(globalThis,'fetch',async () => new Response(new Uint8Array(128)));
  await assert.rejects(downloadRom(),/incomplete/);
});
test('streaming downloads cannot grow beyond the expected ROM size',async t => {
  const {downloadRom,ROM_BYTES}=await source();
  let cancelled=false;
  const stream=new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(ROM_BYTES+1));},cancel() {cancelled=true;}});
  t.mock.method(globalThis,'fetch',async () => new Response(stream));
  await assert.rejects(downloadRom(),/has changed/); assert.ok(cancelled);
});
test('a different ROM of the same size is rejected by its SHA-256 fingerprint',async t => {
  const {downloadRom,ROM_BYTES}=await source();
  t.mock.method(globalThis,'fetch',async () => new Response(new Uint8Array(ROM_BYTES)));
  await assert.rejects(downloadRom(),/has changed/);
});
test('unresponsive hosted downloads time out and release the request',async t => {
  const {downloadRom}=await source();
  let delay;
  t.mock.method(globalThis,'setTimeout',(callback,ms) => {delay=ms; queueMicrotask(callback); return 0;});
  t.mock.method(globalThis,'fetch',(_url,{signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true})));
  await assert.rejects(downloadRom(),/timed out/); assert.equal(delay,45000);
});
