/* Self-hosted Evo browser calculator, using the original physical keypad. */
(() => {
  'use strict';
  const page=document.getElementById('calcPage'), shell=document.getElementById('graphCalculator');
  const button=document.getElementById('evoOpen');
  const view=document.createElement('section');
  view.id='evoView'; view.className='evo-view'; view.hidden=true;
  view.setAttribute('aria-label','TI-84 Evo emulator');
  view.innerHTML='<iframe class="evo-frame" title="TI-84 Evo display and calculator keypad" allow="cross-origin-isolated" tabindex="0"></iframe><div class="evo-toolbar"><p role="status">Starting TI-84 Evo…</p><button type="button" hidden>Retry</button></div>';
  shell.append(view);
  const frame=view.querySelector('iframe'), status=view.querySelector('[role="status"]'), retry=view.querySelector('button');
  let active=false,started=false,timer;
  function show(value) {
    active=value; view.hidden=!value; page.classList.toggle('evo-active',value);
    button.setAttribute('aria-checked',String(value));
    window.dispatchEvent(new Event('resize'));
  }
  function remember(value) {try {localStorage.setItem('gregle-calc-engine',value);} catch (_) {}}
  function start() {
    started=true; status.textContent='Starting TI-84 Evo…'; status.classList.remove('evo-error'); retry.hidden=true;
    frame.src='assets/ti84evo/index.html?v=20261118-evo1';
    clearTimeout(timer); timer=setTimeout(() => {
      status.textContent='Still starting. Reopen online if offline setup has not finished.'; retry.hidden=false;
    },45000);
  }
  async function open() {
    if (!['calc.gregle.uk','localhost','127.0.0.1'].includes(location.hostname)) {
      const url=new URL('https://calc.gregle.uk/'); url.searchParams.set('engine','evo');
      if (new URLSearchParams(location.search).get('popout')==='1') url.searchParams.set('popout','1');
      location.assign(url.href); return;
    }
    button.disabled=true;
    try {
      for (const [id,peer] of Object.entries(window.GregleEmulators || {})) if (id!=='evo') await peer.deactivate();
      show(true); remember('evo'); if (!started) start(); frame.focus({preventScroll:true});
    } finally {button.disabled=false;}
  }
  window.addEventListener('message',event => {
    if (event.origin!==location.origin || event.source!==frame.contentWindow) return;
    if (!['gregle-evo-ready','gregle-evo-error'].includes(event.data?.type)) return;
    clearTimeout(timer);
    const error=event.data.type==='gregle-evo-error';
    status.textContent=error ? event.data.message : 'TI-84 Evo · ready';
    status.classList.toggle('evo-error',error); retry.hidden=!error;
  });
  button.addEventListener('click',() => {if (active) {show(false); remember('scientific');} else void open();});
  retry.addEventListener('click',start);
  window.GregleEmulators.evo={isActive:() => active,
    deactivate:async () => show(false),beforePopout:async () => {},
    prepareOffline:async () => ({ready:true})};
  let preferred; try {preferred=localStorage.getItem('gregle-calc-engine');} catch (_) {}
  if ((new URLSearchParams(location.search).get('engine') || preferred)==='evo') void open();
})();
