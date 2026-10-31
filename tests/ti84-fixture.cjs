// A tiny original eZ80 diagnostic image, not TI firmware. It disables interrupts
// and loops at address zero. The minimal model record identifies the CE hardware.
function makeTestRom() {
  const rom=new Uint8Array(4*1024*1024); rom.fill(255);
  rom.set([0xF3,0xC3,0,0,0],0);
  const fields=[0x80,0x12,0x13,0,0x80,0x21,0,0x80,0x32,0,0,0x80,0xA1,0,0x80,0xC2,0,0,0,0,0,0,0,0,0,0];
  rom.set([0x80,0x0F,0,0,0,fields.length,...fields],0x20000);
  return rom;
}
module.exports={makeTestRom};
