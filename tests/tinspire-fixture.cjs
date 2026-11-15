// Original ARM diagnostic, with synthetic CX CAS hardware metadata. No TI code.
function diagnosticFirmware() {
  const boot=new Uint8Array(0x80000), flash=new Uint8Array(33*1024*1024);
  flash.fill(0xff);
  const b=new DataView(boot.buffer), f=new DataView(flash.buffer);
  // Write 42 to RAM, leave its address/value in R0/R1, then loop forever.
  [0xe59f0008,0xe3a0102a,0xe5801000,0xeafffffe,0x10000000].forEach((word,i)=>b.setUint32(i*4,word,true));
  f.setUint32(0,0x796eb03c,true); f.setUint16(0x844,0x0f,true); f.setUint16(0x846,0,true);
  f.setUint32(0x858,0x4c9e5f91,true); f.setUint32(0x85c,5,true);
  f.setUint32(0x87c,0x561002,true); f.setUint32(0x880,0xfe018011,true);
  return {boot,flash};
}
module.exports={diagnosticFirmware};
