/* Keep the Home Screen scientific calculator steady while iOS settles its viewport. */
(() => {
  'use strict';
  const root = document.documentElement, page = document.getElementById('calcPage');
  const mobile = window.matchMedia('(max-width:700px), (pointer:coarse) and (max-height:600px)');
  const native = () => page.matches('.scientific-only:not(.emulator-active):not(.ti89-active):not(.tinspire-active)');
  const enabled = () => root.classList.contains('calculator-standalone') && mobile.matches && native();
  const properties = ['--scientific-app-height','--scientific-safe-top','--scientific-safe-right','--scientific-safe-bottom','--scientific-safe-left'];
  let frame = 0, width = window.innerWidth, started = 0, signature = '', stable = 0, touchY = 0;
  function clearSize() {properties.forEach(name => root.style.removeProperty(name));}
  function settle(now) {
    frame = 0;
    if (!enabled()) {root.classList.add('scientific-viewport-ready'); return;}
    if (!started) started = now;
    const style = getComputedStyle(document.body), height = document.body.getBoundingClientRect().height;
    const padding = [style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft];
    const next = [window.innerWidth,height,...padding].join(':');
    stable = next === signature ? stable+1 : 0; signature = next;
    if (stable >= 8 || now-started >= 600) {
      root.style.setProperty(properties[0],`${height}px`);
      padding.forEach((value,index) => root.style.setProperty(properties[index+1],value));
      width = window.innerWidth; root.classList.add('scientific-viewport-ready'); return;
    }
    frame = requestAnimationFrame(settle);
  }
  function start() {
    if (frame) cancelAnimationFrame(frame);
    clearSize(); started = 0; signature = ''; stable = 0;
    if (!enabled()) {root.classList.add('scientific-viewport-ready'); return;}
    root.classList.remove('scientific-viewport-ready'); frame = requestAnimationFrame(settle);
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load',start,{once:true});
  // Height-only launch/status-bar events must not expand an already visible calculator.
  window.addEventListener('resize',() => {if (window.innerWidth !== width) start();});
  window.addEventListener('pageshow',event => {if (event.persisted && window.innerWidth !== width) start();});
  mobile.addEventListener?.('change',start);
  new MutationObserver(start).observe(page,{attributes:true,attributeFilter:['class']});

  // Position the cursor directly instead of invoking iOS input-focus scrolling.
  document.addEventListener('pointerdown',event => {
    const input = event.target;
    if (!enabled() || input.id !== 'expression' || !input.readOnly || event.isPrimary === false) return;
    event.preventDefault();
    const cursor = document.getElementById('homeCursor'), cell = parseFloat(getComputedStyle(cursor).width) || 10;
    const position = Math.max(0,Math.min(input.value.length,Math.round((event.clientX-input.getBoundingClientRect().left+input.scrollLeft)/cell)));
    input.setSelectionRange(position,position); input.dispatchEvent(new Event('select'));
  },{passive:false});

  document.addEventListener('touchstart',event => {if (event.touches.length === 1) touchY = event.touches[0].clientY;},{passive:true});
  document.addEventListener('touchmove',event => {
    if (!enabled() || event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.01) return;
    const y = event.touches[0].clientY, delta = y-touchY; touchY = y;
    const scroller = event.target.closest('#historyList,.home-error,.gregle-menu-panel');
    const scrollable = scroller && scroller.scrollHeight > scroller.clientHeight+1;
    const withinBounds = scrollable && (delta < 0 ? scroller.scrollTop+scroller.clientHeight < scroller.scrollHeight-1 : scroller.scrollTop > 0);
    if (!withinBounds && event.cancelable) event.preventDefault();
  },{passive:false});
})();
