/* Prepare and report offline calculator availability without changing modes. */
(() => {
  'use strict';
  let registration, running, scheduled=false, appReady=false, romReady=false, romRemoved=false, ti89Ready=false, ti89Removed=false, nspireReady=false, nspireRemoved=false, setupError='';
  const installed=() => document.documentElement.classList.contains('calculator-standalone');
  const dedicated=window.location.hostname==='calc.gregle.uk';
  const workerPath=dedicated ? '/calc-sw.js?v=20261118-unit-converter1' : '/gregle-sw.js?v=20261115-offline1';
  const workerOptions={scope:'/',updateViaCache:'none'};
  function render() {
    let message;
    if (appReady) {
      const ready=['scientific'];
      if (romReady) ready.push('TI-84 CE');
      if (ti89Ready) ready.push('TI-89');
      if (nspireReady) ready.push('CX CAS');
      message='Ready offline · '+ready.join(', ')+'.';
      const missing=[];
      if (!romReady && !romRemoved) missing.push('TI-84 CE');
      if (!ti89Ready && !ti89Removed) missing.push('TI-89');
      if (setupError) message+=' '+setupError;
      else if (missing.length) message+=' Open '+missing.join(' or ')+' once online to save it too.';
      if (!nspireReady && !nspireRemoved) message+=' Open CX CAS once online to save it offline (133 MiB).';
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
        const results=await Promise.allSettled(['ti84','ti89','tinspire'].map(engine => window.GregleEmulators[engine].prepareOffline({download:appReady && installed() && navigator.onLine})));
        romReady=results[0].status==='fulfilled' && results[0].value.ready;
        romRemoved=results[0].status==='fulfilled' && Boolean(results[0].value.removed);
        ti89Ready=results[1].status==='fulfilled' && results[1].value.ready;
        ti89Removed=results[1].status==='fulfilled' && Boolean(results[1].value.removed);
        nspireReady=results[2].status==='fulfilled' && results[2].value.ready;
        nspireRemoved=results[2].status==='fulfilled' && Boolean(results[2].value.removed);
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
      const existing=dedicated ? await navigator.serviceWorker.getRegistration('/') : null;
      registration=existing || await navigator.serviceWorker.register(workerPath,workerOptions);
      watchWorker(registration.installing);
      registration.addEventListener('updatefound',() => {watchWorker(registration.installing);});
      if (dedicated && navigator.onLine) {
        void registration.update().catch(() => {});
      }
      await check();
    } catch (_) {setupError='Offline setup incomplete. Retry online.'; render();}
  }
  function waitForActivation(worker) {
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => finish(new Error('The update is taking longer than expected. Try again online.')),60000);
      function finish(error,active) {
        clearTimeout(timer);
        worker.removeEventListener('statechange',onState);
        if (error) reject(error);
        else resolve(active);
      }
      function onState() {
        if (worker.state==='activated') finish(null,true);
        else if (worker.state==='redundant') finish(new Error('The download could not finish. Try again online.'));
        else if (worker.state==='installed' && !dedicated && registration.active) finish(null,false);
      }
      worker.addEventListener('statechange',onState);
      onState();
    });
  }

  const updateButton=document.getElementById('updateCalculatorOffline');
  const updateStatus=document.getElementById('calculatorOfflineUpdateStatus');
  updateButton.addEventListener('click',async () => {
    if (!navigator.onLine) {updateStatus.textContent='Connect to the internet to update the offline copy.'; return;}
    updateButton.disabled=true;
    updateStatus.textContent='Downloading the offline copy…';
    try {
      if (!registration) await start();
      if (!registration) throw new Error('Offline setup is unavailable in this browser.');
      if (dedicated) {
        // A distinct script URL reinstalls the bundle even when the release
        // number is unchanged. It uses a new cache until the download passes.
        const url=new URL(workerPath,window.location.href);
        url.searchParams.set('calc-refresh',crypto.randomUUID());
        registration=await navigator.serviceWorker.register(url.href,workerOptions);
        const worker=[registration.installing,registration.waiting,registration.active].find(item => item?.scriptURL===url.href);
        if (!worker || !await waitForActivation(worker)) throw new Error('The offline copy could not be downloaded. Try again online.');
      } else {
        await registration.update();
        const worker=registration.installing || registration.waiting || registration.active;
        if (!worker) throw new Error('The calculator could not check for updates. Try again online.');
        if (!await waitForActivation(worker)) {
          updateStatus.textContent='Update downloaded. Close other Gregle windows to apply it.';
          return;
        }
      }
      if (!registration.active || !await cached(registration.active)) {
        throw new Error('The offline copy is still being prepared. Try again online.');
      }
      try {sessionStorage.setItem('gregle-calc-reload',JSON.stringify(window.GregleScientific.getState()));} catch (_) {}
      updateStatus.textContent='Offline copy ready. Reopening calculator…';
      window.location.reload();
    } catch (error) {
      updateStatus.textContent=error instanceof Error && error.constructor===Error ? error.message : 'The update could not finish. Try again online.';
    } finally {
      updateButton.disabled=false;
    }
  });

  document.querySelectorAll('[data-offline-retry]').forEach(button => button.addEventListener('click',async () => {
    // A failed first install can remove its registration. Register again rather
    // than repeatedly updating a redundant worker that can no longer recover.
    if (!registration?.active) {await start(); return;}
    try {await registration.update();} catch (_) {}
    await check();
  }));
  for (const engine of ['ti84','ti89','tinspire']) window.addEventListener(`gregle-${engine}-storage`,() => {void check();});
  window.addEventListener('online',() => {if (registration?.active) {void registration.update().catch(() => {}); void check();} else void start();});
  window.addEventListener('offline',() => {void check();});
  window.addEventListener('appinstalled',() => {void check();});
  document.addEventListener('visibilitychange',() => {
    if (!document.hidden && registration) {void check(); if (navigator.onLine) void registration.update().catch(() => {});}
  });
  void start();
})();
