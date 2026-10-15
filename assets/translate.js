(() => {
  'use strict';
  const frame=document.getElementById('translatorFrame');
  const status=document.getElementById('translatorStatus');
  const reload=document.getElementById('reloadTranslator');
  let timer;
  function watch() {
    clearTimeout(timer);
    timer=setTimeout(()=>{status.textContent='If Microsoft Translator has not appeared, use the Open Microsoft link.';reload.disabled=false;},15000);
  }
  frame.addEventListener('load',()=>{clearTimeout(timer);reload.disabled=false;status.textContent='Microsoft panel finished loading. Use Open Microsoft if your browser blocks embedded translation.';});
  reload.addEventListener('click',()=>{reload.disabled=true;status.textContent='Reloading Microsoft Translator.';frame.src='https://www.bing.com/translator?from=auto-detect&to=en';watch();});
  watch();
})();
