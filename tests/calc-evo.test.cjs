const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Evo serves only the fixed vendor paths, without forwarding private headers',async () => {
  const {evoAsset}=await import('../workers/calculator/evo.mjs');
  const original=global.fetch; const calls=[];
  global.fetch=async (...args) => {calls.push(args);return new Response('wasm',{headers:{'Content-Type':'application/wasm','Set-Cookie':'upstream=private'}});};
  try {
    const result=await evoAsset(new Request('https://calc.gregle.uk/assets/ti84evo/vendor/ti84-7.0.0.4117.wasm',{headers:{Cookie:'private',Authorization:'secret'}}));
    assert.equal(await result.text(),'wasm');
    assert.equal(result.headers.get('Content-Type'),'application/wasm');
    assert.equal(result.headers.get('Set-Cookie'),null);
    assert.equal(result.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');
    assert.equal(calls[0][0],'https://ti84evo.pages.dev/js/ti84-7.0.0.4117.wasm');
    assert.equal(calls[0][1].headers,undefined);
    assert.equal((await evoAsset(new Request('https://calc.gregle.uk/assets/ti84evo/vendor/unknown.js'))).status,404);
    assert.equal(calls.length,1);
    assert.equal((await evoAsset(new Request('https://calc.gregle.uk/assets/ti84evo/vendor/ti84.js',{method:'POST'}))).status,405);
    assert.equal(calls.length,1);
  } finally {global.fetch=original;}
});

test('Evo download errors and HTML fallbacks cannot become cached emulator code',async () => {
  const {evoAsset}=await import('../workers/calculator/evo.mjs');
  const original=global.fetch;
  try {
    for (const response of [new Response('no',{status:404}),new Response('<html>',{headers:{'Content-Type':'text/html'}}),new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}})]) {
      global.fetch=async () => response;
      const result=await evoAsset(new Request('https://calc.gregle.uk/assets/ti84evo/vendor/ti84.js'));
      assert.equal(result.status,502);assert.equal(result.headers.get('Cache-Control'),'no-store');
    }
  } finally {global.fetch=original;}
});

test('calculator hosting sets isolation headers while other apps keep their headers',async () => {
  const worker=(await import('../workers/site-router-recovery/worker.mjs')).default;
  const original=global.fetch;
  global.fetch=async () => new Response('page',{headers:{'Content-Type':'text/html'}});
  try {
    for (const path of ['/','/assets/ti84evo/index.html?v=20261118-evo1']) {
      const result=await worker.fetch(new Request('https://calc.gregle.uk'+path),{});
      assert.equal(result.headers.get('Cross-Origin-Opener-Policy'),'same-origin');
      assert.equal(result.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');
    }
    const weather=await worker.fetch(new Request('https://weather.gregle.uk/'),{});
    assert.equal(weather.headers.get('Cross-Origin-Embedder-Policy'),null);
  } finally {global.fetch=original;}
});
