const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {makeTestRom}=require('./ti84-fixture.cjs');
const directory=path.join(__dirname,'../assets/ti84');
async function engine() {
  const {default:create}=await import(pathToFileURL(path.join(directory,'cemu.mjs')));
  return create({wasmBinary:fs.readFileSync(path.join(directory,'cemu.wasm')),print() {},printErr() {}});
}
test('real CEmu WebAssembly loads and executes an original diagnostic ROM',async () => {
  const core=await engine(); core.FS.writeFile('/calculator.rom',makeTestRom());
  assert.equal(core._gregle_load_rom(),0);
  for(let i=0;i<8;i++) core._gregle_step();
  assert.equal(core._gregle_save_state(),1);
  const state=core.FS.readFile('/calculator.state');
  assert.ok(state.length>4*1024*1024,'snapshot includes complete flash and RAM');
  assert.equal(new DataView(state.buffer,state.byteOffset).getUint32(0,true),0xCECE001C);
  const pixels=core._gregle_frame();
  assert.ok(pixels>0 && pixels+320*240*4<=core.HEAPU8.length);
  for(let i=3;i<320*240*4;i+=4) assert.equal(core.HEAPU8[pixels+i],255);
});
test('complete calculator snapshots survive a new emulator instance',async () => {
  const first=await engine(); first.FS.writeFile('/calculator.rom',makeTestRom()); first._gregle_load_rom();
  first._gregle_key(3,1,1); for(let i=0;i<5;i++) first._gregle_step(); first._gregle_key(3,1,0);
  assert.equal(first._gregle_save_state(),1);
  const saved=first.FS.readFile('/calculator.state');
  const second=await engine(); second.FS.writeFile('/calculator.state',saved);
  assert.equal(second._gregle_load_state(),0);
  assert.equal(second._gregle_save_state(),1);
  const restored=second.FS.readFile('/calculator.state');
  assert.deepEqual(restored,saved,'ROM, RAM, processor and peripherals are restored without another ROM import');
  second._gregle_step(); assert.equal(second._gregle_save_state(),1);
  assert.notDeepEqual(second.FS.readFile('/calculator.state'),saved,'restored CPU continues executing');
});
test('wrong-model ROMs and malformed snapshots are rejected by the emulator',async () => {
  const core=await engine();
  core.FS.writeFile('/calculator.rom',new Uint8Array(1024));
  assert.notEqual(core._gregle_load_rom(),0);
  core.FS.writeFile('/calculator.state',new Uint8Array([0,0,0,0]));
  assert.notEqual(core._gregle_load_state(),0);
});
