const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.join(__dirname,'../assets/ti89');
function diagnosticRom() {
  const bytes=new ArrayBuffer(2097152), v=new DataView(bytes);
  v.setUint32(0,0x4c00); v.setUint32(4,0x212100); v.setUint16(0x10000,0xfff8);
  v.setUint16(0x12000,0x800f); v.setUint16(0x12006,0x8011); v.setUint16(0x12008,0x0300);
  v.setUint16(0x12100,0x60fe); // Original 68000 BRA loop; no TI firmware.
  return bytes;
}
function engine() {
  const messages=[]; let tick;
  const sandbox={Uint16Array,Uint8Array,Uint8ClampedArray,ArrayBuffer,DataView,TextEncoder,TextDecoder,structuredClone,performance,
    setTimeout(fn) {tick=fn;return 1;},clearTimeout() {},self:{postMessage(data) {messages.push(data);}},
    importScripts(file) {vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context);}};
  const context=vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base,'worker.js'),'utf8'),context);
  return {send(data) {sandbox.self.onmessage({data});return messages.findLast(message => message.id===data.id);},step(count=1) {for(let i=0;i<count;i++) tick();},messages};
}
test('TI-89 worker executes a diagnostic ROM, renders and restores full CPU, flash and RAM snapshots',() => {
  const a=engine();assert.equal(a.send({type:'load',id:1,rom:diagnosticRom()}).type,'reply');a.step(305);
  assert(a.messages.some(x=>x.type==='ready'));assert.equal(a.messages.find(x=>x.type==='frame').pixels.byteLength,160*100*4);
  a.send({type:'key',row:33,down:true});a.step(5);a.send({type:'key',row:33,down:false});a.step(5);
  a.send({type:'pause',id:2,paused:true});
  const saved=a.send({type:'save',id:3}).state;assert(saved.byteLength>2097152+262144);
  const b=engine();assert.equal(b.send({type:'load',id:4,rom:diagnosticRom(),state:saved}).restored,true);
  b.send({type:'pause',id:5,paused:true});assert.deepEqual(new Uint8Array(b.send({type:'save',id:6}).state),new Uint8Array(saved));
  b.step(3);
});
test('wrong ROM models, invalid sizes and damaged snapshots never report a loaded calculator',() => {
  const a=engine();assert.equal(a.send({type:'load',id:1,rom:new ArrayBuffer(1024)}).type,'error');
  assert.equal(a.send({type:'load',id:2,rom:new ArrayBuffer(2097152)}).type,'error');
  assert.equal(a.send({type:'load',id:3,rom:diagnosticRom(),state:new ArrayBuffer(8)}).type,'error');
});
test('the Titanium layout includes every hardware key once, with four correctly styled arrow controls',() => {
  let layout;
  vm.runInNewContext(fs.readFileSync(path.join(base,'../calc-ti89.js'),'utf8'),{window:{createGregleEmulator(value) {layout=value;}}});
  const keys=[...layout.menus,...layout.controls,...layout.keys,...layout.arrows];
  assert.equal(keys.length,50);assert.deepEqual(Array.from(keys,key=>key[2]).sort((a,b)=>a-b),Array.from({length:49},(_,i)=>i).concat(80));
  assert(layout.arrows.every(key=>key.length===4),'shared D-pad renderer appends its directional class to four-field mappings');
  assert.equal(layout.diamond.f3,'GRAPH');assert.equal(layout.keys.find(key=>key[0]==='y')[4],'sin');
});
