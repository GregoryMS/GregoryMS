/* Gregle calculator emulator frontend. SPDX-License-Identifier: GPL-3.0-or-later */
function createGregleEmulator(options) {
  'use strict';
  options ||= {};
  const engine=options.engine || 'ti84', is89=engine==='ti89';
  const model=is89 ? 'TI-89' : 'TI-84 Plus CE', prefix=is89 ? 'ti89' : 'emulator';
  const width=is89 ? 160 : 320, height=is89 ? 100 : 240;
  const magic=is89 ? 'GREGLE89' : 'GREGLE84', extension=is89 ? 'gregle89' : 'gregle84';
  const $ = id => document.getElementById(id.replace(/^emulator/,prefix));
  const modeButtons=() => document.querySelectorAll('#emulatorOpen,#ti89Open');
  const setBusy=value => {busy=value; modeButtons().forEach(button => {button.disabled=value;});};
  const CORE_VERSION = is89 ? 'ti68k-babdb7de-gregle-1' : 'e5ffbb2c-gregle-1', STORAGE_KEY = 'session';
  const scriptURL = new URL(document.currentScript.src);
  const workerURL = new URL(`${engine}/worker.${is89 ? 'js' : 'mjs'}`,scriptURL);
  const shell = $('graphCalculator'), page = $('calcPage');
  const modeButton = $('emulatorOpen');
  if (!shell || !modeButton) return;
  const owner = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let active=false, loaded=false, paused=false, busy=false, remote=false, visibilityPaused=false, starting=false;
  let worker, database, record, savePromise, saveTimer, romDownload, sequence=0;
  const downloadListeners = new Set();
  const pending = new Map(), pointers = new Map(), hardware = new Map();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`gregle-${engine}-session`) : null;

  // Primary hardware keys, followed by their 2nd and ALPHA legends.
  const menus = options.menus || [
    ['yeq','Y=',1,4,'STAT PLOT'],['window','WINDOW',1,3,'TBLSET'],
    ['zoom','ZOOM',1,2,'FORMAT'],['trace','TRACE',1,1,'CALC'],['graph','GRAPH',1,0,'TABLE']
  ];
  const controls = options.controls || [
    ['second','2nd',1,5,'','', 'second-key'],['mode','MODE',1,6,'QUIT'],['del','DEL',1,7,'INS'],
    ['alpha','ALPHA',2,7,'A-LOCK','', 'alpha-key'],['variable','X,T,θ,n',3,7,'LINK'],['stat','STAT',4,7,'LIST']
  ];
  const keys = options.keys || [
    ['math','MATH',2,6,'TEST','A'],['apps','APPS',3,6,'ANGLE','B'],['prgm','PRGM',4,6,'DRAW','C'],['vars','VARS',5,6,'DISTR'],['clear','CLEAR',6,6,'','','clear-key'],
    ['inverse','x⁻¹',2,5,'MATRIX','D'],['sin','sin',3,5,'sin⁻¹','E'],['cos','cos',4,5,'cos⁻¹','F'],['tan','tan',5,5,'tan⁻¹','G'],['power','^',6,5,'π','H'],
    ['square','x²',2,4,'√','I'],['comma',',',3,4,'EE','J'],['leftparen','(',4,4,'{','K'],['rightparen',')',5,4,'}','L'],['divide','÷',6,4,'e','M','emu-operator'],
    ['log','log',2,3,'10ˣ','N'],['7','7',3,3,'u','O','emu-number'],['8','8',4,3,'v','P','emu-number'],['9','9',5,3,'w','Q','emu-number'],['multiply','×',6,3,'[','R','emu-operator'],
    ['ln','ln',2,2,'eˣ','S'],['4','4',3,2,'L4','T','emu-number'],['5','5',4,2,'L5','U','emu-number'],['6','6',5,2,'L6','V','emu-number'],['subtract','−',6,2,']','W','emu-operator'],
    ['store','sto→',2,1,'RCL','X'],['1','1',3,1,'L1','Y','emu-number'],['2','2',4,1,'L2','Z','emu-number'],['3','3',5,1,'L3','θ','emu-number'],['add','+',6,1,'MEM','"','emu-operator'],
    ['on','ON',2,0,'OFF'],['0','0',3,0,'CATALOG','␣','emu-number'],['decimal','.',4,0,'i',':','emu-number'],['negative','(−)',5,0,'ANS','?'],['enter','ENTER',6,0,'ENTRY','SOLVE','emu-enter']
  ];
  const arrows = options.arrows || [['up','▲',7,3],['left','◀',7,1],['right','▶',7,2],['down','▼',7,0]];
  const allKeys = [...menus,...controls,...keys,...arrows];
  const byName = new Map(allKeys.map(key => [key[0],key]));
  function keyHTML([name,label,row,col,second='',alpha='',style='']) {
    const diamond=options.diamond?.[name] || '';
    const aria = ({shift:'Shift',diamond:'Diamond modifier',del:'Backspace',up:'Navigate up',down:'Navigate down',left:'Navigate left',right:'Navigate right',negative:'Negative sign'})[name] || label;
    const title=(second ? `2nd: ${second}` : label)+(diamond ? ` · Diamond: ${diamond}` : '')+(alpha ? ` · ALPHA: ${alpha}` : '');
    return `<button type="button" class="hardware-key ${style}" data-emu-key="${name}" data-emu-row="${row}" data-emu-col="${col}" aria-label="${aria}" title="${title.replaceAll('"','&quot;')}"><span class="emu-legend"><span>${second}</span>${diamond ? `<span class="emu-diamond-legend">◆ ${diamond}</span>` : ''}<b>${alpha}</b></span>${label}</button>`;
  }
  const view = document.createElement('section');
  view.id=prefix+'View'; view.className='emulator-view'; view.hidden=true;
  view.setAttribute('aria-label',model+' emulator');
  view.innerHTML=`
    <div class="emu-display"><div class="emu-lcd">
      <canvas id="emulatorCanvas" width="${width}" height="${height}" tabindex="0" aria-label="TI-84 Plus CE display. Use the calculator keys below or a hardware keyboard."></canvas>
      <section class="emu-overlay" id="emulatorSetup" aria-labelledby="emulatorSetupTitle">
        <h2 id="emulatorSetupTitle">TI-84 Plus CE</h2>
        <p id="emulatorSetupText">Your calculator will download automatically and stay saved on this device.</p>
        <button type="button" class="emu-primary" id="emulatorDownload">Load calculator</button>
        <button type="button" id="emulatorImport">Choose ROM file</button>
        <button type="button" id="emulatorRestoreSetup">Restore backup</button>
        ${is89 ? '<p class="emu-fine-print"><a href="https://cloud.gregle.uk/public.php/dav/files/xN2iNF4ZP4Eo45b/?accept=zip" target="_blank" rel="noopener noreferrer">Download ROM file</a> · then choose the downloaded file above if automatic setup is unavailable.</p>' : ''}
        <p class="emu-fine-print">The first download comes from ${is89 ? 'your supplied ROM link' : 'Catbox'}. You can also choose your own TI-84 Plus CE .rom file; selected files are never uploaded.</p>
      </section>
      <section class="emu-overlay" id="emulatorSession" aria-labelledby="emulatorSessionTitle" hidden>
        <button type="button" class="emu-close" id="emulatorCloseSession">Close</button>
        <h2 id="emulatorSessionTitle">Your calculator</h2>
        <p id="emulatorSessionInfo">ROM and session are saved on this device.</p>
        <p class="calc-offline-status" data-offline-status role="status">Preparing offline use…</p>
        <button type="button" data-offline-retry hidden>Retry offline setup</button>
        <div class="emu-session-actions">
          <button type="button" id="emulatorSave">Save now</button><button type="button" id="emulatorPause">Pause</button>
          <button type="button" id="emulatorExport">Export backup</button><button type="button" id="emulatorRestore">Restore backup</button>
          <button type="button" id="emulatorProgram">Import program</button><button type="button" id="emulatorRestart">Restart calculator</button>
          <button type="button" id="emulatorReplace">Replace ROM</button><button type="button" id="emulatorForget">Remove saved ROM</button>
        </div>
        <p class="emu-fine-print">Backups contain your ROM and calculator memory. Keep them private. Clearing site data removes this device’s saved calculator.</p>
        <p class="emu-fine-print"><a href="assets/ti84/README.md" target="_blank" rel="noopener">${is89 ? 'TI-68k' : 'CEmu'} source and licence</a> · Independent project; not affiliated with Texas Instruments.</p>
      </section>
    </div></div>
    <div class="emu-toolbar"><span id="emulatorStatus" role="status" aria-live="polite">One-time ROM setup</span><button type="button" id="emulatorSessionButton">Session</button></div>
    <div class="graph-menu-keys emu-menu-keys" role="group" aria-label="TI-84 graph menus">${menus.map(keyHTML).join('')}</div>
    <div class="emu-control-grid" role="group" aria-label="TI-84 controls">
      ${controls.slice(0,3).map(keyHTML).join('')}
      <div class="graph-dpad emu-pad" role="group" aria-label="TI-84 directional pad">
        ${arrows.map(key => keyHTML([...key,'','','pad-'+key[0]])).join('')}<span class="pad-center" aria-hidden="true"></span>
      </div>${controls.slice(3).map(keyHTML).join('')}
    </div>
    <div class="emu-keypad" role="group" aria-label="TI-84 keypad">${keys.map(keyHTML).join('')}</div>
    <div class="emu-credits"><span>${is89 ? 'TI-89 · TI-68K' : 'TI-84 PLUS CE · CEMU'}</span><span>LOCAL ROM · AUTO SAVE</span></div>
    <input type="file" id="emulatorRomFile" accept=".rom,application/octet-stream" hidden>
    <input type="file" id="emulatorBackupFile" accept=".gregle84,application/octet-stream" hidden>
    <input type="file" id="emulatorProgramFile" accept=".8xp,.8xv,.8xg,.8xk,.8xl,.8xm,.8xn,.8xs,.8xi,.8xc,.8ca,.8cl,.8ef" hidden>`.replaceAll('emulator',prefix).replaceAll('TI-84 Plus CE',model).replaceAll('TI-84',is89 ? 'TI-89' : 'TI-84').replaceAll('assets/ti84/',`assets/${engine}/`).replaceAll('.gregle84',`.${extension}`);
  shell.append(view);
  view.dataset.engine=engine;
  if (is89) {view.classList.add('ti89-view'); $('emulatorProgramFile').accept='.89p,.89f,.89e,.89l,.89m,.89s,.89t,.89z'; $('emulatorProgram').hidden=true;}
  view.querySelectorAll('[data-emu-key]').forEach(button => {button.disabled=true;});
  const canvas=$('emulatorCanvas'), context=canvas.getContext('2d',{alpha:false});
  let lastFrame;
  function status(message,error=false) {
    $('emulatorStatus').textContent=message;
    $('emulatorStatus').classList.toggle('emu-storage-error',error);
  }
  function preference(value) {try {localStorage.setItem('gregle-calc-engine',value);} catch (_) {}}
  function show(activeValue) {
    active=activeValue; page.classList.toggle(is89 ? 'ti89-active' : 'emulator-active',active); view.hidden=!active;
    modeButton.setAttribute('aria-checked',String(active));
    if (!active) releaseAll();
    window.dispatchEvent(new Event('resize'));
  }
  async function db() {
    if (!database) database = new Promise((resolve,reject) => {
      if (!window.indexedDB) {reject(new Error('Device storage is unavailable.')); return;}
      const request=indexedDB.open(`gregle-${engine}`,1);
      request.onupgradeneeded=() => request.result.createObjectStore('calculator');
      request.onsuccess=() => {request.result.onversionchange=() => {request.result.close(); database=null;}; resolve(request.result);};
      request.onerror=() => {database=null; reject(request.error);};
      request.onblocked=() => {database=null; reject(new Error('Close other calculator tabs to unlock storage.'));};
    });
    return database;
  }
  async function stored(change) {
    const connection=await db();
    return new Promise((resolve,reject) => {
      const transaction=connection.transaction('calculator',change ? 'readwrite' : 'readonly');
      const store=transaction.objectStore('calculator'), request=store.get(STORAGE_KEY);
      let result, failure;
      request.onsuccess=() => {
        try {
          result=change ? change(request.result) : request.result;
          if (change) {if (result === null) store.delete(STORAGE_KEY); else store.put(result,STORAGE_KEY);}
        } catch (error) {failure=error; transaction.abort();}
      };
      transaction.oncomplete=() => {
        resolve(result);
        if (change) window.dispatchEvent(new Event(`gregle-${engine}-storage`));
      };
      transaction.onabort=transaction.onerror=() => reject(failure || transaction.error || new Error('Could not save on this device.'));
    });
  }
  function destroyWorker() {
    worker?.terminate(); worker=null; loaded=false;
    for (const item of pending.values()) {clearTimeout(item.timer); item.reject(new Error('Calculator restarted.'));}
    pending.clear();
  }
  function getWorker() {
    if (worker) return worker;
    worker=new Worker(workerURL,is89 ? {} : {type:'module'});
    worker.onmessage=({data}) => {
      if (data.type === 'frame') {
        lastFrame=new ImageData(new Uint8ClampedArray(data.pixels),width,height);
        context.putImageData(lastFrame,0,0);
      } else if (data.type === 'transfer') {
        status(data.progress < 0 ? 'Program transfer failed. Try again from HOME.' : data.progress >= 100 ? 'Program imported · open PRGM to run it' : `Importing program… ${data.progress}%`,data.progress<0);
        if (data.progress >= 100) scheduleSave();
      } else if (data.type === 'fatal') {paused=true; status(data.message,true);}
      else if (data.type === 'ready') {starting=false; view.querySelectorAll('[data-emu-key]').forEach(button => {button.disabled=false;}); void save();}
      else {
        const item=pending.get(data.id);
        if (item) {clearTimeout(item.timer); pending.delete(data.id); data.type === 'error' ? item.reject(new Error(data.message)) : item.resolve(data);}
      }
    };
    worker.onerror=() => {
      status('The emulator could not start. Refresh to retry; your saved ROM is kept.',true);
      destroyWorker();
    };
    return worker;
  }
  function request(type,data={}) {
    return new Promise((resolve,reject) => {
      const instance=getWorker(), id=++sequence;
      const timer=setTimeout(() => {pending.delete(id); reject(new Error('The emulator did not respond. Open Session to restart it.'));},30000);
      pending.set(id,{resolve,reject,timer}); instance.postMessage({type,id,...data});
    });
  }
  function releaseAll() {
    pointers.clear(); hardware.clear();
    view.querySelectorAll('.is-down').forEach(button => button.classList.remove('is-down'));
    if (loaded) worker?.postMessage({type:'release'});
  }
  async function save() {
    clearTimeout(saveTimer);
    if (!loaded || !record || remote) return false;
    if (savePromise) return savePromise;
    savePromise=(async () => {
      try {
        const {state,bootFrames}=await request('save');
        const next={...record,state,bootFrames,coreVersion:CORE_VERSION,updatedAt:Date.now(),owner};
        await stored(current => {
          if (current && current.owner !== owner) throw new Error('This calculator was opened in another window. Resume here to continue.');
          return next;
        });
        record=next;
        status(paused ? 'Paused · saved on this device' : starting ? 'Starting TI-OS… · saved on this device' : 'Saved on this device');
        return true;
      } catch (error) {status(`Not saved: ${error.message} Export a backup from Session.`,true); return false;}
      finally {savePromise=null;}
    })();
    return savePromise;
  }
  function scheduleSave() {clearTimeout(saveTimer); saveTimer=setTimeout(() => {void save();},1500);}
  async function pause(value) {
    if (!loaded) return;
    releaseAll(); paused=value; await request('pause',{paused:value});
    $('emulatorPause').textContent=paused ? 'Resume' : 'Pause';
  }
  async function yieldSession(requireSaved=false) {
    if (!loaded || remote) return;
    await pause(true);
    if (!await save() && requireSaved) {await pause(false); throw new Error('The session could not be saved for the new window.');}
    remote=true;
    status('Saved · calculator continued in another window');
    $('emulatorPause').textContent='Resume here';
    $('emulatorSessionButton').textContent='Resume here';
  }
  const handoffs=new Map();
  if (channel) channel.onmessage=async ({data}) => {
    if (data.owner === owner) return;
    if (data.type === 'takeover' && loaded && !remote) {
      await yieldSession(); channel.postMessage({type:'yielded',owner,request:data.request});
    } else if (data.type === 'yielded') handoffs.get(data.request)?.();
  };
  async function takeOver() {
    if (!channel) return;
    const id=++sequence;
    await new Promise(resolve => {
      const finish=() => {clearTimeout(timer); handoffs.delete(id); resolve();};
      const timer=setTimeout(finish,450); handoffs.set(id,finish);
      channel.postMessage({type:'takeover',owner,request:id});
    });
  }
  async function boot(next,{fresh=false}={}) {
    status(`Starting ${model}…`); setBusy(true);
    modeButton.disabled=true;
    $('emulatorImport').disabled=true;
    $('emulatorDownload').disabled=true;
    try {
      destroyWorker();
      const result=await request('load',{rom:next.rom,state:!fresh && next.coreVersion===CORE_VERSION ? next.state : null,bootFrames:next.bootFrames});
      record={...next,owner,coreVersion:CORE_VERSION}; loaded=true; paused=false; remote=false;
      starting=result.bootFrames>0;
      view.querySelectorAll('[data-emu-key]').forEach(button => {button.disabled=starting;});
      // Claim the record only after the emulator accepts the new ROM. An invalid
      // import must never erase the previous saved calculator.
      try {await stored(() => record);} catch (_) {}
      $('emulatorSetup').hidden=true; $('emulatorSession').hidden=true;
      $('emulatorPause').textContent='Pause';
      $('emulatorSessionButton').textContent='Session';
      $('emulatorSessionInfo').textContent=`${record.name || model} · ROM and session stay on this device.`;
      preference(engine);
      const saved=await save();
      if (saved) status(starting ? 'Starting TI-OS… · saved on this device' : 'Session restored · saved on this device');
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
      canvas.focus({preventScroll:true});
    } catch (error) {
      loaded=false; $('emulatorSetup').hidden=false;
      view.querySelectorAll('[data-emu-key]').forEach(button => {button.disabled=true;});
      status(error.message,true);
    } finally {setBusy(false); $('emulatorImport').disabled=false; $('emulatorDownload').disabled=false;}
  }
  function downloadDisabled() {
    try {return localStorage.getItem(`gregle-${engine}-download-disabled`)==='1';} catch (_) {return false;}
  }
  async function getDownload(onProgress) {
    if (onProgress) downloadListeners.add(onProgress);
    try {
      if (!romDownload) romDownload=(async () => {
        const {downloadRom}=await import(new URL(is89 ? 'ti89/rom-source.mjs?v=20261102-ti89-6' : 'ti84/rom-source.mjs?v=20261031-hosted1',scriptURL));
        return downloadRom({onProgress:value => {for (const listener of downloadListeners) listener(value);}});
      })().finally(() => {romDownload=null;});
      return await romDownload;
    } finally {if (onProgress) downloadListeners.delete(onProgress);}
  }
  async function prepareOffline({download=false}={}) {
    if ((await stored())?.rom) return {ready:true};
    if (downloadDisabled()) return {ready:false,removed:true};
    if (!download) return {ready:false};
    const downloaded=await getDownload();
    // Recheck inside the transaction: importing, restoring or removing a ROM
    // while this download runs must win over background offline preparation.
    const saved=await stored(current => current?.rom ? current : downloadDisabled() ? null : {...downloaded,updatedAt:Date.now()});
    if (saved?.rom) {
      try {if (!localStorage.getItem('gregle-calc-engine')) preference('scientific');} catch (_) {}
    }
    return {ready:Boolean(saved?.rom),removed:downloadDisabled()};
  }
  async function downloadCalculator() {
    if (busy) return;
    setBusy(true);
    for (const id of ['emulatorImport','emulatorRestoreSetup','emulatorDownload']) $(id).disabled=true;
    $('emulatorDownload').textContent='Downloading…';
    $('emulatorSetup').hidden=false;
    $('emulatorSetupText').textContent='Preparing your calculator. This download is only needed once on this device.';
    status('Downloading calculator…');
    let downloaded;
    try {
      let progress=-1;
      downloaded=await getDownload(value => {if (value!==progress) {progress=value; status(`Downloading calculator… ${value}%`);}});
      try {localStorage.removeItem(`gregle-${engine}-download-disabled`);} catch (_) {}
    } catch (error) {
      $('emulatorSetupText').textContent='The automatic download could not finish. You can retry, restore a backup or choose your own ROM file.';
      status(error.message || 'Could not download the calculator. Please retry.',true);
    } finally {
      setBusy(false);
      for (const id of ['emulatorImport','emulatorRestoreSetup','emulatorDownload']) $(id).disabled=false;
      $('emulatorDownload').textContent='Retry download';
    }
    if (downloaded) await boot(downloaded,{fresh:true});
  }
  async function open() {
    for (const [id,peer] of Object.entries(window.GregleEmulators || {})) if (id!==engine) await peer.deactivate();
    show(true); preference(engine);
    if (busy) return;
    if (loaded && !remote) {await pause(false); await save(); return;}
    await takeOver();
    try {
      const saved=await stored();
      if (saved?.rom) {await boot(saved); return;}
    } catch (_) {status('Device storage is unavailable. Export a backup to keep your calculator.',true);}
    let disabled=false;
    try {disabled=localStorage.getItem(`gregle-${engine}-download-disabled`)==='1';} catch (_) {}
    if (!disabled) {await downloadCalculator(); return;}
    status('Saved calculator removed · load again when ready');
    $('emulatorSetupText').textContent='Your saved calculator was removed. Load it again or choose a ROM file when you want to continue.';
    $('emulatorDownload').textContent='Load calculator';
    $('emulatorSetup').hidden=false;
  }
  $('emulatorDownload').addEventListener('click',() => {void downloadCalculator();});
  modeButton.addEventListener('click',async () => {
    if (active) {await pause(true); await save(); show(false); preference('scientific');}
    else await open();
  });
  $('emulatorSessionButton').addEventListener('click',async () => {
    if (remote) {await open(); return;}
    if (!loaded) {$('emulatorSetup').hidden=false; return;}
    releaseAll(); $('emulatorSession').hidden=false; $('emulatorCloseSession').focus({preventScroll:true});
  });
  $('emulatorCloseSession').addEventListener('click',() => {$('emulatorSession').hidden=true; canvas.focus({preventScroll:true});});
  $('emulatorSave').addEventListener('click',() => {void save();});
  $('emulatorPause').addEventListener('click',async () => {
    if (remote) {await open(); return;}
    await pause(!paused); await save();
  });
  const chooseRom=() => {if (!busy) $('emulatorRomFile').click();};
  $('emulatorImport').addEventListener('click',chooseRom); $('emulatorReplace').addEventListener('click',chooseRom);
  $('emulatorRomFile').addEventListener('change',async event => {
    const file=event.target.files[0]; event.target.value=''; if (!file || busy) return;
    if (is89 ? ![2*1024*1024,4*1024*1024].includes(file.size) : /\.8eu$/i.test(file.name) || file.size<0x40000 || file.size>8*1024*1024) {status(`Choose a full ${model} .rom dump, rather than an OS update or program file.`,true); return;}
    const rom=await file.arrayBuffer();
    await takeOver(); await boot({rom,name:file.name,updatedAt:Date.now()}, {fresh:true});
  });
  $('emulatorRestart').addEventListener('click',async () => {
    if (!loaded || !confirm('Restart the emulated calculator? Unsaved calculator work may be lost. Your ROM will stay saved.')) return;
    if (remote) {await open(); return;}
    releaseAll(); await request('reset'); starting=true;
    view.querySelectorAll('[data-emu-key]').forEach(button => {button.disabled=true;});
    await pause(false); $('emulatorSession').hidden=true; scheduleSave();
  });
  $('emulatorForget').addEventListener('click',async () => {
    if (!confirm('Remove this device’s saved ROM and calculator session? Export a backup first if you want to keep them.')) return;
    try {
      await pause(true); await save(); await takeOver(); await stored(() => null);
      try {localStorage.setItem(`gregle-${engine}-download-disabled`,'1');} catch (_) {}
      destroyWorker(); record=null; remote=false; clearTimeout(saveTimer);
      $('emulatorSession').hidden=true; $('emulatorSetup').hidden=false;
      context.clearRect(0,0,width,height); status('Saved ROM removed · import a ROM to start again');
    } catch (error) {status(error.message,true);}
  });
  function download(blob,name) {
    const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=name; link.click();
    setTimeout(() => URL.revokeObjectURL(url),10000);
  }
  $('emulatorExport').addEventListener('click',async () => {
    if (!record) return;
    try {
      if (remote) await open();
      const {state,bootFrames}=await request('save');
      const metadata=new TextEncoder().encode(JSON.stringify({version:1,name:record.name,coreVersion:CORE_VERSION,bootFrames,romLength:record.rom.byteLength,stateLength:state.byteLength}));
      const header=new Uint8Array(12); header.set(new TextEncoder().encode(magic));
      new DataView(header.buffer).setUint32(8,metadata.length,true);
      download(new Blob([header,metadata,record.rom,state],{type:'application/octet-stream'}),`calculator.${extension}`);
      status('Backup exported · keep this file private');
    } catch (error) {status(error.message,true);}
  });
  const chooseBackup=() => $('emulatorBackupFile').click();
  $('emulatorRestore').addEventListener('click',chooseBackup); $('emulatorRestoreSetup').addEventListener('click',chooseBackup);
  $('emulatorBackupFile').addEventListener('change',async event => {
    const file=event.target.files[0]; event.target.value=''; if (!file || busy) return;
    try {
      if (file.size>70*1024*1024 || file.size<12) throw new Error(`Choose a Gregle ${model} backup (.${extension}).`);
      const bytes=await file.arrayBuffer(), header=new Uint8Array(bytes,0,8);
      if (new TextDecoder().decode(header)!==magic) throw new Error('This is not a Gregle calculator backup.');
      const length=new DataView(bytes).getUint32(8,true);
      if (length>2048 || 12+length>bytes.byteLength) throw new Error('This backup is damaged.');
      const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,12,length)));
      if (meta.version!==1 || !Number.isInteger(meta.romLength) || !Number.isInteger(meta.stateLength) || meta.romLength<0x40000 || meta.romLength>8*1024*1024 || meta.stateLength<4 || meta.stateLength>12*1024*1024 || bytes.byteLength!==12+length+meta.romLength+meta.stateLength) throw new Error('This backup is damaged or unsupported.');
      if (loaded && !confirm('Replace the current calculator with this backup?')) return;
      const start=12+length; await takeOver();
      await boot({name:typeof meta.name==='string' ? meta.name.slice(0,160) : model,coreVersion:meta.coreVersion,bootFrames:meta.bootFrames,rom:bytes.slice(start,start+meta.romLength),state:bytes.slice(start+meta.romLength)});
    } catch (error) {status(error.message,true);}
  });
  $('emulatorProgram').addEventListener('click',() => $('emulatorProgramFile').click());
  $('emulatorProgramFile').addEventListener('change',async event => {
    const file=event.target.files[0]; event.target.value=''; if (!file || !loaded || remote) return;
    try {
      if (starting) throw new Error('Wait for TI-OS to finish starting before importing a program.');
      if (file.size<8 || file.size>4*1024*1024) throw new Error('Choose a compatible TI calculator program or variable file.');
      const bytes=await file.arrayBuffer(), signature=new TextDecoder().decode(new Uint8Array(bytes,0,8));
      if (is89 ? signature!=='**TI89**' : signature!=='**TI83F*' && signature!=='**TIFL**') throw new Error('This file is not a supported TI program or variable file.');
      await pause(false); await request('program',{bytes}); $('emulatorSession').hidden=true; status('Importing program…');
    } catch (error) {status(error.message,true);}
  });
  function sendKey(name,down) {
    if (!loaded || paused || remote || !active || busy || starting) return;
    const key=byName.get(name); if (!key) return;
    worker.postMessage({type:'key',row:key[2],col:key[3],down});
    view.querySelector(`[data-emu-key="${name}"]`)?.classList.toggle('is-down',down);
    if (!down) scheduleSave();
  }
  view.addEventListener('pointerdown',event => {
    const button=event.target.closest('[data-emu-key]'); if (!button || (event.pointerType==='mouse' && event.button!==0)) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.set(event.pointerId,button.dataset.emuKey); sendKey(button.dataset.emuKey,true);
  });
  function pointerUp(event) {const name=pointers.get(event.pointerId); if (name) {sendKey(name,false); pointers.delete(event.pointerId);}}
  view.addEventListener('pointerup',pointerUp); view.addEventListener('pointercancel',pointerUp); view.addEventListener('lostpointercapture',pointerUp);
  view.addEventListener('click',event => {
    const button=event.target.closest('[data-emu-key]');
    if (button && event.detail===0) {sendKey(button.dataset.emuKey,true); setTimeout(() => sendKey(button.dataset.emuKey,false),80);}
  });
  const keyMap=options.keyMap || {Enter:'enter',Backspace:'del',Delete:'del',Escape:'clear',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Shift:'second',Alt:'alpha',F1:'yeq',F2:'window',F3:'zoom',F4:'trace',F5:'graph','+':'add','-':'subtract','*':'multiply','/':'divide','^':'power','(':'leftparen',')':'rightparen',',':'comma','.':'decimal','_':'negative',Home:'on',s:'sin',c:'cos',t:'tan',l:'ln',g:'log',x:'variable',m:'math',p:'prgm',v:'vars'};
  for (let i=0;i<=9;i++) keyMap[String(i)]=String(i);
  document.addEventListener('keydown',event => {
    if (!active || $('gregleAppMenu')?.open) return;
    if (!$('emulatorSession').hidden || !$('emulatorSetup').hidden) {
      if (event.key==='Escape' && !$('emulatorSession').hidden) {event.preventDefault(); event.stopImmediatePropagation(); $('emulatorCloseSession').click();}
      return;
    }
    if (event.ctrlKey || event.metaKey || (event.altKey && event.key!=='Alt') || event.key==='Tab') return;
    if ((event.key==='Enter' || event.key===' ') && event.target.tagName==='BUTTON') return;
    const name=keyMap[event.key]; if (!name) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) {hardware.set(event.code,name); sendKey(name,true);}
  },true);
  document.addEventListener('keyup',event => {
    const name=hardware.get(event.code); if (!name) return;
    event.preventDefault(); event.stopImmediatePropagation(); sendKey(name,false); hardware.delete(event.code);
  },true);
  window.addEventListener('blur',releaseAll);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) {releaseAll(); if (loaded && !remote) {visibilityPaused=!paused; void pause(true); void save();}}
    else if (visibilityPaused && active && loaded && !remote) {visibilityPaused=false; void pause(false); void save();}
  });
  window.addEventListener('pagehide',() => {releaseAll(); void save();});
  setInterval(() => {if (active && loaded && !remote && !document.hidden) void save();},30000);
  window.GregleEmulators ||= {};
  window.GregleEmulators[engine]={isActive:() => active,prepareOffline,
    deactivate:async () => {if (active) {await pause(true); await save(); show(false);}},
    beforePopout:async () => {if (active) await yieldSession(true);}};
  window.GregleEmulator={
    isActive:() => Object.values(window.GregleEmulators).some(item => item.isActive()),
    selectedEngine:() => Object.entries(window.GregleEmulators).find(([,item]) => item.isActive())?.[0],
    prepareOffline:settings => window.GregleEmulators.ti84.prepareOffline(settings),
    beforePopout:async () => {for (const item of Object.values(window.GregleEmulators)) if (item.isActive()) await item.beforePopout();}
  };
  // A saved ROM boots straight into the calculator. No file picker is opened.
  (async () => {
    let preferred;
    try {preferred=localStorage.getItem('gregle-calc-engine');} catch (_) {}
    const requested=new URLSearchParams(location.search).get('engine');
    if ((requested || preferred)===engine) {await open(); return;}
    if (!requested && !preferred && !is89) {try {if ((await stored())?.rom) await open();} catch (_) {}}
  })();
}
window.createGregleEmulator=createGregleEmulator;
createGregleEmulator();
