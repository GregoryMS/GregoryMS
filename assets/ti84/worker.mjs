/* SPDX-License-Identifier: GPL-3.0-or-later */
import createCEmu from './cemu.mjs';

let core, running = false, timer, nextTick = 0, frame = 0;
let keys = new Map(), releases = new Map(), transfer = false, bootFrames = 0;
const reply = (id, data = {}, buffers = []) => self.postMessage({type:'reply',id,...data},buffers);
function releaseAll() {
  if (core) for (let r=0;r<8;r++) for (let c=0;c<8;c++) core._gregle_key(r,c,0);
  keys.clear(); releases.clear();
}
function draw() {
  const pointer = core._gregle_frame();
  const pixels = core.HEAPU8.slice(pointer,pointer+320*240*4);
  self.postMessage({type:'frame',pixels:pixels.buffer,on:Boolean(core._gregle_lcd_on())},[pixels.buffer]);
}
function tick() {
  if (!running) return;
  try {
    const now = performance.now();
    // Cap catch-up work after a suspended tab; never simulate minutes of backlog.
    if (now-nextTick > 100) nextTick = now;
    let count = 0;
    do {
      frame++;
      for (const [code,at] of releases) if (frame >= at) {
        const [row,col] = code.split(':').map(Number);
        core._gregle_key(row,col,0); keys.delete(code); releases.delete(code);
      }
      core._gregle_step(); nextTick += 1000/60;
      if (bootFrames>0 && --bootFrames===0) self.postMessage({type:'ready'});
    } while (performance.now() >= nextTick && ++count < 3);
    if (frame%2 === 0) draw();
    if (transfer) {
      const progress = core._gregle_transfer_status();
      self.postMessage({type:'transfer',progress});
      if (progress < 0 || progress >= 100) transfer = false;
    }
    timer = setTimeout(tick,Math.max(0,nextTick-performance.now()));
  } catch (error) {
    running = false;
    self.postMessage({type:'fatal',message:'The emulator stopped. Open Session to restart or restore your saved calculator.'});
  }
}
function run(value) {
  clearTimeout(timer); running = Boolean(value);
  if (running) {nextTick=performance.now(); timer=setTimeout(tick,0);}
  else releaseAll();
}
self.onmessage = async ({data}) => {
  const {id,type} = data;
  try {
    if (type === 'load') {
      run(false);
      core = await createCEmu({print() {},printErr() {}});
      core.FS.writeFile('/calculator.rom',new Uint8Array(data.rom));
      if (core._gregle_load_rom() !== 0) throw new Error('This is not a valid TI-84 Plus CE ROM. Choose a full .rom dump from your calculator.');
      let restored = false;
      if (data.state) {
        try {
          core.FS.writeFile('/calculator.state',new Uint8Array(data.state));
          restored = core._gregle_load_state() === 0;
        } catch (_) {}
        if (!restored && core._gregle_load_rom() !== 0) throw new Error('The saved session could not be restored. Import your ROM again.');
      }
      bootFrames=restored ? Math.max(0,Math.min(600,Number(data.bootFrames)||0)) : 600;
      releaseAll(); frame=0; draw(); run(true); reply(id,{restored,bootFrames});
    } else if (!core) throw new Error('Import your calculator ROM first.');
    else if (type === 'save') {
      if (!core._gregle_save_state()) throw new Error('The calculator session could not be saved.');
      const state = core.FS.readFile('/calculator.state');
      reply(id,{state:state.buffer,bootFrames},[state.buffer]);
    } else if (type === 'pause') {run(!data.paused); reply(id);}
    else if (type === 'reset') {releaseAll(); core._gregle_reset(); bootFrames=600; reply(id);}
    else if (type === 'release') {releaseAll();}
    else if (type === 'key' && running && !bootFrames) {
      const code = `${data.row}:${data.col}`;
      if (data.down) {
        releases.delete(code);
        if (!keys.has(code)) {keys.set(code,frame); core._gregle_key(data.row,data.col,1);}
      } else if (keys.has(code)) releases.set(code,Math.max(frame+1,keys.get(code)+4));
    } else if (type === 'program') {
      if (transfer) throw new Error('Wait for the current program transfer to finish.');
      core.FS.writeFile('/program.8xp',new Uint8Array(data.bytes));
      if (core._gregle_send_file() !== 0) throw new Error('The calculator could not start this transfer. Return to its home screen and try again.');
      transfer=true; reply(id);
    }
  } catch (error) {self.postMessage({type:'error',id,message:error.message || 'The emulator could not complete this action.'});}
};
