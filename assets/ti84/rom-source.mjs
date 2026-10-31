/* User-configured ROM download. SPDX-License-Identifier: GPL-3.0-or-later */
export const ROM_SOURCE='https://files.catbox.moe/5cc8ln.rom';
export const ROM_BYTES=4194304;
export const ROM_SHA256='ef2ef036b2adc67560c555208cf642763dd346b57242cd233df8399bdaee4b70';

export async function downloadRom({onProgress=() => {}}={}) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),45000);
  let reader;
  try {
    const response=await fetch(ROM_SOURCE,{mode:'cors',credentials:'omit',signal:controller.signal,referrerPolicy:'no-referrer'});
    if (!response.ok || !response.body) throw new Error('The calculator download is unavailable. Retry or choose a ROM file.');
    const declared=Number(response.headers.get('content-length'));
    if (declared && declared!==ROM_BYTES) throw new Error('The hosted calculator file has changed. Choose your own ROM file instead.');
    reader=response.body.getReader();
    const rom=new Uint8Array(ROM_BYTES);
    let received=0;
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      if (received+value.length>ROM_BYTES) throw new Error('The hosted calculator file has changed. Choose your own ROM file instead.');
      rom.set(value,received); received+=value.length;
      onProgress(Math.floor(received/ROM_BYTES*100));
    }
    if (received!==ROM_BYTES) throw new Error('The calculator download was incomplete. Please retry.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rom)),byte => byte.toString(16).padStart(2,'0')).join('');
    if (hash!==ROM_SHA256) throw new Error('The hosted calculator file has changed. Choose your own ROM file instead.');
    return {rom:rom.buffer,name:'TI-84 Plus CE',source:ROM_SOURCE};
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The calculator download timed out. Please retry.');
    if (error instanceof TypeError) throw new Error('Could not reach the calculator download. Retry or choose a ROM file.');
    throw error;
  } finally {
    clearTimeout(timeout);
    if (reader) {try {await reader.cancel();} catch (_) {}}
    controller.abort();
  }
}
