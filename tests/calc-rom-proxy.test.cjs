const {test}=require('node:test');
const assert=require('node:assert/strict');
const endpoint='https://calc.gregle.uk/api/calculator/ti89-rom';
const modulePromise=import('../workers/calculator/calc-rom.mjs');
test('ROM endpoint permits only the fixed model and read methods, without contacting arbitrary hosts',async () => {
  const {calculatorRom}=await modulePromise;let calls=0;
  const fetcher=async () => {calls++;throw Error('Must not fetch');};
  for(const [url,method,status] of [[endpoint+'?url=https://example.com','GET',400],[endpoint,'POST',405],['https://weather.gregle.uk/api/calculator/ti89-rom','GET',404],[endpoint,'HEAD',200]]) {
    const response=await calculatorRom(new Request(url,{method}),fetcher);assert.equal(response.status,status);
  }
  assert.equal(calls,0);
});
test('redirects, unexpected firmware, truncated and oversized bodies are rejected without storing a ROM',async () => {
  const {calculatorRom,TI89_ROM_URL}=await modulePromise;
  for (const response of [new Response(null,{status:302,headers:{Location:'https://example.com'}}),new Response(new Uint8Array(20)),new Response(new Uint8Array(2097152)),new Response(new Uint8Array(2097153))]) {
    const result=await calculatorRom(new Request(endpoint,{headers:{Cookie:'private',Authorization:'private'}}),async (url,options) => {
      assert.equal(url,TI89_ROM_URL);assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);return response;
    });
    assert.equal(result.status,502);assert.equal(result.headers.get('Cache-Control'),'no-store');
  }
});
