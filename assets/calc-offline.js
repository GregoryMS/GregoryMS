/* Prepare and report offline calculator availability without changing modes. */
(() => {
  'use strict';
  let registration, running, scheduled=false, appReady=false, romReady=false, romRemoved=false, ti89Ready=false, ti89Removed=false, setupError='';
  const installed=() => document.documentElement.classList.contains('calculator-standalone');
  function render() {
    let message;
    if (appReady) {
      const ready=['scientific','graphing'];
      if (romReady) ready.push('TI-84 CE');
      if (ti89Ready) ready.push('TI-89');
      message='Ready offline · '+ready.join(', ')+'.';
      const missing=[];
      if (!romReady && !romRemoved) missing.push('TI-84 CE');
      if (!ti89Ready && !ti89Removed) missing.push('TI-89');
      if (setupError) message+=' '+setupError;
      else if (missing.length) message+=' Open '+missing.join(' or ')+' once online to save it too.';
    } else message=setupError || 'Preparing offline use…';
    if (registration?.waiting) message+=' Update ready · close all calculator windows to apply.';
    document.querySelectorAll('[data-offline-status]').forEach(node => {node.textContent=message;});
    document.querySelectorAll('[data-offline-retry]').forEach(node => {node.hidden=!setupError;});
  }
  function cached(worker) {
    return new Promise((resolve,reject) => {
      const channel=new MessageChannel();
      const timer=setTimeout(() => {channel.port1.close(); reject(new Error('Offline setup is still pending. Reopen online to finish.'));},5000);
      channel.port1.onmessage=({data}) => {clearTimeout(timer); channel.port1.close(); resolve(data.ready===true);};
      worker.postMessage({type:'calculator-offline-status'},[channel.port2]);
    });
  }
  async function check() {
    if (running) {scheduled=true; return running;}
    running=(async () => {
      setupError='';
      try {
        appReady=Boolean(registration?.active) && await cached(registration.active);
        const results=await Promise.allSettled(['ti84','ti89'].map(engine => window.GregleEmulators[engine].prepareOffline({download:appReady && installed() && navigator.onLine})));
        romReady=results[0].status==='fulfilled' && results[0].value.ready;
        romRemoved=results[0].status==='fulfilled' && Boolean(results[0].value.removed);
        ti89Ready=results[1].status==='fulfilled' && results[1].value.ready;
        ti89Removed=results[1].status==='fulfilled' && Boolean(results[1].value.removed);
        if (!appReady) setupError=navigator.onLine ? 'Finishing offline setup. Keep this calculator open online.' : 'Offline setup incomplete. Reopen online to finish.';
        else if (results.some(result => result.status==='rejected')) setupError='An emulator ROM could not be saved. Retry online.';
        if (appReady && installed() && navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
      } catch (_) {setupError=appReady ? 'An emulator ROM could not be saved. Retry online.' : 'Offline setup incomplete. Retry online.';}
      render();
    })().finally(() => {running=null; if (scheduled) {scheduled=false; void check();}});
    render();
    return running;
  }
  function watchWorker(worker) {
    if (!worker) return;
    worker.addEventListener('statechange',() => {if (['activated','installed','redundant'].includes(worker.state)) void check();});
  }
  async function start() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      setupError='Offline use needs a secure browser with service workers.'; render(); return;
    }
    try {
      registration=await navigator.serviceWorker.register('/calc-sw.js?v=20261102-ti89-6',{scope:'/',updateViaCache:'none'});
      watchWorker(registration.installing);
      registration.addEventListener('updatefound',() => {watchWorker(registration.installing);});
      await check();
    } catch (_) {setupError='Offline setup incomplete. Retry online.'; render();}
  }
  document.querySelectorAll('[data-offline-retry]').forEach(button => button.addEventListener('click',async () => {
    // A failed first install can remove its registration. Register again rather
    // than repeatedly updating a redundant worker that can no longer recover.
    if (!registration?.active) {await start(); return;}
    try {await registration.update();} catch (_) {}
    await check();
  }));
  for (const engine of ['ti84','ti89']) window.addEventListener(`gregle-${engine}-storage`,() => {void check();});
  window.addEventListener('online',() => {if (registration?.active) {void registration.update().catch(() => {}); void check();} else void start();});
  window.addEventListener('offline',() => {void check();});
  window.addEventListener('appinstalled',() => {void check();});
  document.addEventListener('visibilitychange',() => {
    if (!document.hidden && registration) {void check(); if (navigator.onLine) void registration.update().catch(() => {});}
  });
  void start();
})();
