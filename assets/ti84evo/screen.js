/* Adapter for the downloaded browser engine and its original Evo keypad. */
(() => {
  'use strict';
  const report=(type,message) => parent.postMessage({type,message},location.origin);
  function fail(message) {
    const error=document.getElementById('evoError'); error.textContent=message; error.hidden=false;
    report('gregle-evo-error',message);
  }
  if (!crossOriginIsolated || typeof SharedArrayBuffer==='undefined') {
    fail('This browser cannot start the Evo engine. Update your browser and reopen the calculator online.'); return;
  }
  // The Emscripten data loader resolves its archive relative to the document.
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...args) {
    if (typeof url==='string' && url==='ti84-7.0.0.4117.data') url=new URL('vendor/'+url,location.href).href;
    return Reflect.apply(open,this,[method,url,...args]);
  };
  // The standalone source does not use the vendor's remote session service.
  globalThis.WebSocket=EventTarget;
  globalThis._0xd9ef810=501; globalThis._0xd653516=36; globalThis._0xd9a3c76=161;
  globalThis._0xd853516=15; globalThis._0xd1a3c76=23;
  window.addEventListener('error',() => fail('Evo could not start. Reopen online and choose Update offline copy from the calculator menu.'));
  const calculator=new TI84();
  calculator.init({calcmodel:'TI84EVO',elementId:'calculatorDiv',onInitialized:() => {
    const canvas=document.getElementById('display');
    const keypad=canvas?.closest('.tiwc_container_keypad');
    if (!keypad) {fail('The Evo display could not be prepared. Reopen the calculator online.'); return;}
    canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','TI-84 Evo display');
    const display=document.createElement('div'); display.className='evo-lcd-overlay';
    // Move the actual renderer canvas, retaining its WebAssembly context.
    display.append(canvas); keypad.append(display);
    report('gregle-evo-ready');
  },
    KeyHistBufferLength:'10',DisplayMode:'MATHPRINT',AngleMode:'RAD',journee:window.lJour,language:'en'});
})();
