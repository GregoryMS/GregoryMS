/* Device-local CX CAS firmware bundle. SPDX-License-Identifier: GPL-3.0-or-later */
const MIB=1024*1024;
export function validateFirmware(boot,flash) {
  if (boot.byteLength!==0x80000) throw new Error('Choose a complete CX CAS Boot1 dump (512 KiB).');
  if (![33*MIB,132*MIB].includes(flash.byteLength)) throw new Error('Choose a Firebird flash image (33 or 132 MiB), not a .tcc OS update.');
  const header=new DataView(flash.buffer,flash.byteOffset,flash.byteLength);
  if (header.getUint32(0,true)!==0x796eb03c || header.getUint16(0x844,true)!==0x0f || header.getUint32(0x858,true)!==0x4c9e5f91) throw new Error('This flash image is not for the TI-Nspire CX CAS.');
  const cfg=header.getUint32(0x880,true), logsize=(cfg&7)+((cfg>>>3)&7);
  if (logsize>4) throw new Error('The flash image has an invalid memory configuration.');
  const words=new Uint32Array(boot.buffer,boot.byteOffset,boot.byteLength/4);
  if (words.every(word=>word===0 || word===0xffffffff)) throw new Error('The Boot1 dump is empty or damaged.');
}
export function packFirmware(boot,flash) {
  validateFirmware(boot,flash);
  const bytes=new Uint8Array(16+boot.byteLength+flash.byteLength);
  bytes.set(new TextEncoder().encode('GREGNSP1'));
  const header=new DataView(bytes.buffer);
  header.setUint32(8,boot.byteLength,true); header.setUint32(12,flash.byteLength,true);
  bytes.set(boot,16); bytes.set(flash,16+boot.byteLength);
  return bytes.buffer;
}
export function unpackFirmware(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength<16) throw new Error('Choose both Boot1 and flash files.');
  const header=new DataView(buffer), bootLength=header.getUint32(8,true), flashLength=header.getUint32(12,true);
  if (new TextDecoder().decode(new Uint8Array(buffer,0,8))!=='GREGNSP1' || bootLength!==0x80000 || ![33*MIB,132*MIB].includes(flashLength) || buffer.byteLength!==16+bootLength+flashLength) throw new Error('This CX CAS firmware bundle is damaged.');
  const boot=new Uint8Array(buffer,16,bootLength), flash=new Uint8Array(buffer,16+bootLength,flashLength);
  validateFirmware(boot,flash);
  return {boot,flash};
}
