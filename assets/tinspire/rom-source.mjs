/* User-configured firmware; downloaded once into device storage.
   SPDX-License-Identifier: GPL-3.0-or-later */
import {packFirmware} from './firmware.mjs';
export const FIRMWARE_SOURCE='https://gregle-nspire-firmware.square-rain-5ded.workers.dev';
export const FILES=[
  {path:'/boot1',size:524288,sha256:'0a911a688af9522b6987aa62cf455f592dc37613c44e98de1507bb80d8b94f80'},
  {path:'/flash',size:138412032,sha256:'17bfcc31189d600483d8347d1f6e73b0e8a01f9fc4fe92e717ac34990e7a2139'}
];
export async function downloadRom({onProgress=()=>{}}={}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),180000);
  const total=FILES.reduce((sum,file)=>sum+file.size,0), parts=[];
  let received=0;
  try {
    for (const file of FILES) {
      const response=await fetch(FIRMWARE_SOURCE+file.path,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if (!response.ok || !response.body) throw new Error('The CX CAS download is unavailable. Retry or choose Boot1 and flash files.');
      const declared=Number(response.headers.get('content-length'));
      if (declared && declared!==file.size) {await response.body.cancel(); throw new Error('The hosted CX CAS file has changed. Choose your own files.');}
      const reader=response.body.getReader(), bytes=new Uint8Array(file.size);
      let offset=0;
      try {
        while (true) {
          const {done,value}=await reader.read(); if (done) break;
          if (offset+value.length>file.size) throw new Error('The hosted CX CAS file has changed. Choose your own files.');
          bytes.set(value,offset); offset+=value.length; received+=value.length;
          onProgress(Math.floor(received/total*100));
        }
      } finally {try {await reader.cancel();} catch (_) {}}
      if (offset!==file.size) throw new Error('The CX CAS download was incomplete. Retry online.');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if (digest!==file.sha256) throw new Error('The CX CAS file fingerprint did not match. Choose your own files.');
      parts.push(bytes);
    }
    return {rom:packFirmware(parts[0],parts[1]),name:'TI-Nspire CX CAS',source:FIRMWARE_SOURCE};
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The CX CAS download timed out. Retry online.');
    if (error instanceof TypeError) throw new Error('Could not reach the CX CAS download. Retry online or choose local files.');
    throw error;
  } finally {clearTimeout(timer); controller.abort();}
}
