const {test}=require('node:test'),assert=require('node:assert/strict');
const plus=require('../assets/maps-pluscodes.js');
test('full Plus Codes round-trip precise coordinates without an external service',()=>{
 const code=plus.encode(48.4284,-123.3656),parsed=plus.read(code.toLowerCase()),point=plus.point(parsed);
 assert.equal(parsed.short,false);assert(Math.abs(point.lat-48.4284)<0.00003);assert(Math.abs(point.lng+123.3656)<0.00004);assert.equal(point.name,code);
 assert.equal(plus.read('Coffee shop'),null);assert.equal(plus.read('ZZZZZZZZ+ZZ'),null);
});
test('short codes use the map centre or an explicitly searched locality as their reference',()=>{
 const code='8FVC9G8F+6X',short=plus.read('9G8F+6X Zurich');assert.equal(short.locality,'Zurich');assert.equal(short.short,true);
 assert.equal(plus.point(short,{lat:47.36559,lng:8.524997}).name,code);
 assert.equal(plus.point(plus.read('9G8F+6X'),{lat:47.36559,lng:8.524997}).name,code);
});
