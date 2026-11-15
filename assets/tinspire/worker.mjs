/* SPDX-License-Identifier: GPL-3.0-or-later */
import createFirebird from './firebird.mjs';
import {unpackFirmware} from './firmware.mjs';
let core, running=false, timer, frame=0, nextTick=0, failed=false;
const held=new Map(), releases=new Map();
const reply=(id,data={},buffers=[])=>self.postMessage({type:'reply',id,...data},buffers);
function key(row,col,down) {
  if (row===8) {
    const [x,y]=[[.5,0],[0,.5],[1,.5],[.5,1],[.5,.5]][col] || [.5,.5];
    core._gregle_touch(x,y,down?1:0,down?1:0);
  } else core._gregle_key(row,col,down?1:0);
}
function releaseAll() {
  if (core) {for (let r=0;r<8;r++) for (let c=0;c<11;c++) key(r,c,false); key(8,4,false);}
  held.clear(); releases.clear();
}
function draw() {
  const pointer=core._gregle_frame(), pixels=core.HEAPU8.slice(pointer,pointer+320*240*4);
  self.postMessage({type:'frame',pixels:pixels.buffer},[pixels.buffer]);
}
function tick() {
  if (!running) return;
  try {
    const now=performance.now(); if (now-nextTick>100) nextTick=now;
    frame++;
    for (const [code,at] of releases) if (frame>=at) {key(...code.split(':').map(Number),false); held.delete(code); releases.delete(code);}
    if (!core._gregle_step()) throw new Error('The calculator stopped.');
    if (frame%2===0) draw();
    nextTick+=10;
    timer=setTimeout(tick,Math.max(0,nextTick-performance.now()));
  } catch (_) {
    running=false; failed=true;
    self.postMessage({type:'fatal',message:'The CX CAS stopped. Open Session to restart; the last saved session is kept.'});
  }
}
function run(value) {
  clearTimeout(timer); running=Boolean(value);
  if (running) {nextTick=performance.now();timer=setTimeout(tick,0);} else releaseAll();
}
// Serialize async startup so a delayed load cannot overwrite a pause or save.
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(()=>handle(data)).catch(()=>{});};
async function handle(data) {
  const {type,id}=data;
  try {
    if (type==='load') {
      run(false);
      const {boot,flash}=unpackFirmware(data.rom);
      core=await createFirebird({print(){},printErr(){}});
      core.FS.writeFile('/boot1.img',boot,{canOwn:true}); core.FS.writeFile('/flash.img',flash,{canOwn:true});
      if (data.state) {
        if (data.state.byteLength>210*1024*1024) throw new Error('The saved CX CAS session is too large.');
        core.FS.writeFile('/session.bin',new Uint8Array(data.state));
      }
      if (!core._gregle_start(data.state?1:0)) throw new Error('The CX CAS firmware or saved session could not be loaded. Restore a backup or select matching Boot1 and flash files.');
      releaseAll(); frame=0; failed=false; draw(); run(true); reply(id,{restored:Boolean(data.state),bootFrames:0});
    } else if (!core) throw new Error('Choose Boot1 and flash files first.');
    else if (type==='save') {
      if (failed || !core._gregle_save()) throw new Error('The session could not be saved. Your previous saved session is kept.');
      const state=core.FS.readFile('/session.bin');
      reply(id,{state:state.buffer,bootFrames:0},[state.buffer]);
    } else if (type==='pause') {run(!data.paused && !failed); reply(id);}
    else if (type==='reset') {releaseAll(); core._gregle_reset(); failed=false; reply(id); self.postMessage({type:'ready'});}
    else if (type==='release') releaseAll();
    else if (type==='touch' && running) {
      if (Number.isFinite(data.x) && Number.isFinite(data.y)) core._gregle_touch(Math.max(0,Math.min(1,data.x)),Math.max(0,Math.min(1,data.y)),data.contact?1:0,data.down?1:0);
    }
    else if (type==='key' && running) {
      if (!Number.isInteger(data.row) || !Number.isInteger(data.col) || data.row<0 || data.row>8 || data.col<0 || data.col>(data.row===8?4:10)) return;
      const code=`${data.row}:${data.col}`;
      if (data.down) {releases.delete(code); if (!held.has(code)) {held.set(code,frame); key(data.row,data.col,true);}}
      else if (held.has(code)) releases.set(code,Math.max(frame+1,held.get(code)+4));
    }
  } catch (error) {self.postMessage({type:'error',id,message:error.message || 'The emulator could not complete this action.'});}
}
