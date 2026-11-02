/* Gregle TI-89 worker adapter. SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
importScripts('./ti68k.js');
let core, link, running=false, timer, frame=0, bootFrames=0, screen;
const keys=new Map(), releases=new Map();
const reply=(id,data={},buffers=[]) => self.postMessage({type:'reply',id,...data},buffers);
function releaseAll() {
  if (core) {for (let i=0;i<80;i++) core.setKey(i,0); core.setONKeyReleased();}
  keys.clear(); releases.clear();
}
function key(code,down) {
  if (code===80) down ? core.setONKeyPressed() : core.setONKeyReleased();
  else core.setKey(code,down ? 1 : 0);
}
function draw(address,ram) {
  screen={address,ram};
  if (frame%3) return;
  const pixels=new Uint8ClampedArray(160*100*4);
  for (let y=0;y<100;y++) for (let x=0;x<160;x++) {
    const dark=Boolean(ram[address+y*15+(x>>4)] & (0x8000>>(x&15)));
    const i=(y*160+x)*4;
    pixels[i]=dark ? 36 : 191; pixels[i+1]=dark ? 51 : 207; pixels[i+2]=dark ? 37 : 173; pixels[i+3]=255;
  }
  self.postMessage({type:'frame',pixels:pixels.buffer},[pixels.buffer]);
}
function run(value) {
  clearTimeout(timer); running=Boolean(value);
  if (running) timer=setTimeout(tick,0); else releaseAll();
}
function tick() {
  if (!running) return;
  const start=performance.now();
  try {
    frame++;
    for (const [code,at] of releases) if (frame>=at) {key(code,false); releases.delete(code); keys.delete(code);}
    core.emu_main_loop();
    if (bootFrames>0 && --bootFrames===0) self.postMessage({type:'ready'});
    timer=setTimeout(tick,Math.max(0,11-(performance.now()-start)));
  } catch (_) {
    run(false); self.postMessage({type:'fatal',message:'The emulator stopped. Open Session to restart or restore your calculator.'});
  }
}
function save() {
  const state=core._save_state();
  const {rom,ram,keystatus,...registers}=state;
  const metadata=new TextEncoder().encode(JSON.stringify({version:1,romLength:rom.byteLength,registers,link:link._save_state(),bootFrames}));
  const result=new Uint8Array(8+metadata.length+rom.byteLength+ram.byteLength+80), header=new DataView(result.buffer);
  header.setUint32(0,0x39385447,true); header.setUint32(4,metadata.length,true);
  result.set(metadata,8);
  let offset=8+metadata.length;
  for (const array of [rom,ram]) {for (let i=0;i<array.length;i++,offset+=2) header.setUint16(offset,array[i],true);}
  result.set(keystatus,offset);
  return result.buffer;
}
function restore(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength<8) throw new Error('Invalid TI-89 snapshot.');
  const view=new DataView(bytes), size=view.getUint32(4,true);
  if (view.getUint32(0,true)!==0x39385447 || size>65536 || size+8>bytes.byteLength) throw new Error('Invalid TI-89 snapshot.');
  const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,8,size)));
  if (metadata.version!==1 || !metadata.link || ![3,9].includes(metadata.link.calculator_model) || ![2097152,4194304].includes(metadata.romLength) || bytes.byteLength!==8+size+metadata.romLength+262144+80) throw new Error('Unsupported TI-89 snapshot.');
  let offset=8+size;
  const arrays=[new Uint16Array(metadata.romLength/2),new Uint16Array(131072)];
  for (const array of arrays) for (let i=0;i<array.length;i++,offset+=2) array[i]=view.getUint16(offset,true);
  core._restore_state({...metadata.registers,rom:arrays[0],ram:arrays[1],keystatus:new Uint8Array(bytes,offset,80)});
  link._restore_state(metadata.link);
  bootFrames=Math.max(0,Math.min(900,Number(metadata.bootFrames)||0));
}
function load(rom) {
  if (!(rom instanceof ArrayBuffer) || ![2097152,4194304].includes(rom.byteLength)) throw new Error('Choose a full 2 MB TI-89 or 4 MB TI-89 Titanium ROM dump.');
  const data=new DataView(rom), words=new Uint16Array(rom.byteLength/2);
  for (let i=0;i<words.length;i++) words[i]=data.getUint16(i*2,false);
  // The OS header identifies this model before any emulator code runs.
  const size=words[0x12000/2], model=words[(size===0x800F ? 0x12008 : 0x12006)/2]>>>8;
  if (![0x800F,0x800E].includes(size) || ![3,9].includes(model) || rom.byteLength!==(model===9 ? 4194304 : 2097152)) throw new Error('Choose a TI-89 or TI-89 Titanium .rom file.');
  const stdlib={console:{log() {}},setInterval() {return 1;},clearInterval() {},setTimeout,clearTimeout};
  core=TI68kEmulatorCoreModule(stdlib);
  link=TI68kEmulatorLinkModule(stdlib);
  const ui={setCalculatorModel() {},initemu() {},reset() {},initkeyhandlers() {},display_no_rom_loaded() {throw new Error('The TI-89 ROM could not be loaded.');},draw_screen:draw};
  core.setRom(words); core.setReset(() => {}); core.setUI(ui); core.setLink(link); link.setEmu(core); link.setUI(ui);
  core.initemu();
  if (![3,9].includes(core.calculator_model()) || !core.pc()) throw new Error('The TI-89 ROM could not be started.');
  bootFrames=300; frame=0; releaseAll();
}
self.onmessage=({data}) => {
  const {id,type}=data;
  try {
    if (type==='load') {
      run(false); load(data.rom);
      let restored=false;
      if (data.state) {restore(data.state); restored=true;}
      run(true); reply(id,{restored,bootFrames,calculatorModel:core.calculator_model()});
    } else if (!core) throw new Error('Load your TI-89 ROM first.');
    else if (type==='save') {const state=save(); reply(id,{state,bootFrames},[state]);}
    else if (type==='pause') {run(!data.paused); reply(id);}
    else if (type==='release') releaseAll();
    else if (type==='reset') {releaseAll(); core.initialize_calculator(); bootFrames=300; reply(id);}
    else if (type==='key' && running && !bootFrames && Number.isInteger(data.row) && data.row>=0 && data.row<=80) {
      const code=data.row;
      if (data.down) {releases.delete(code); if (!keys.has(code)) {keys.set(code,frame); key(code,true);}}
      else if (keys.has(code)) releases.set(code,Math.max(frame+1,keys.get(code)+5));
    } else if (type==='program') {
      const bytes=new Uint8Array(data.bytes);
      if (bytes.length<88 || bytes.length>70000 || new TextDecoder().decode(bytes.slice(0,8))!=='**TI89**') throw new Error('Choose a TI-89 program or variable file under 70 KB.');
      core.setNewfileready({result:data.bytes});
      reply(id); self.postMessage({type:'transfer',progress:0});
      // The link protocol runs inside subsequent CPU ticks. Do not claim success
      // before the calculator acknowledges it.
    }
  } catch (error) {self.postMessage({type:'error',id,message:error.message || 'The TI-89 could not complete this action.'});}
};
