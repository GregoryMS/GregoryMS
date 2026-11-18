/* Keep touches in the Home Screen scientific calculator from scrolling the page. */
(() => {
  'use strict';
  const root = document.documentElement, page = document.getElementById('calcPage');
  const mobile = window.matchMedia('(max-width:700px), (pointer:coarse) and (max-height:600px)');
  const native = () => page.matches('.scientific-only:not(.emulator-active):not(.ti89-active):not(.tinspire-active)');
  const enabled = () => root.classList.contains('calculator-standalone') && mobile.matches && native();
  let touchX = 0, touchY = 0;

  // Position the cursor directly instead of invoking iOS input-focus scrolling.
  document.addEventListener('pointerdown',event => {
    const input = event.target;
    if (!enabled() || input.id !== 'expression' || !input.readOnly || event.isPrimary === false) return;
    event.preventDefault();
    const cursor = document.getElementById('homeCursor'), cell = parseFloat(getComputedStyle(cursor).width) || 10;
    const position = Math.max(0,Math.min(input.value.length,Math.round((event.clientX-input.getBoundingClientRect().left+input.scrollLeft)/cell)));
    input.setSelectionRange(position,position); input.dispatchEvent(new Event('select'));
  },{passive:false});

  document.addEventListener('touchstart',event => {
    if (event.touches.length === 1) {
      touchX = event.touches[0].clientX;
      touchY = event.touches[0].clientY;
    }
  },{passive:true});
  document.addEventListener('touchmove',event => {
    if (!enabled() || event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.01) return;
    const {clientX,clientY} = event.touches[0];
    const deltaX = clientX-touchX, delta = clientY-touchY;
    touchX = clientX;
    touchY = clientY;
    if (Math.abs(deltaX)>Math.abs(delta) && event.target.closest('.formula-equations li')) return;
    const scroller = event.target.closest('#homeTranscript,.home-error,.gregle-menu-panel,.scientific-menu');
    const scrollable = scroller && scroller.scrollHeight > scroller.clientHeight+1;
    const withinBounds = scrollable && (delta < 0 ? scroller.scrollTop+scroller.clientHeight < scroller.scrollHeight-1 : scroller.scrollTop > 0);
    if (!withinBounds && event.cancelable) event.preventDefault();
  },{passive:false});
})();
