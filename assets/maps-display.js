/* Layout follows available space, including Tesla's half-screen browser. */
'use strict';
(() => {
  const button = document.createElement('button');
  button.id = 'map-car-layout'; button.type = 'button'; button.className = 'map-car-layout';
  button.title = 'Use larger touchscreen controls'; button.setAttribute('role', 'switch'); button.setAttribute('aria-label', 'Car mode');
  button.innerHTML = '<span class="map-car-label">Car mode</span><span class="map-car-track" aria-hidden="true"><span class="map-car-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 9 2-5h10l2 5M4 9h16v9H4zM7 18v3m10-3v3M7 13h2m6 0h2"/></svg></span></span>';
  const actions = document.querySelector('.top-actions');
  if (!actions) return;
  actions.prepend(button);
  const stage = document.querySelector('.map-stage');
  const tools = document.querySelector('.map-actions');
  function sizeTools() {
    const height = tools?.getBoundingClientRect().height;
    if (stage && height > 0) stage.style.setProperty('--map-tools-height', Math.ceil(height) + 'px');
  }
  let preferred = null;
  try { preferred = localStorage.getItem('gregle-maps-car-layout'); } catch {}
  let enabled = preferred === null ? /Tesla/i.test(navigator.userAgent) : preferred === 'true';
  function apply() {
    document.body.classList.toggle('vehicle-layout', enabled);
    button.setAttribute('aria-checked', String(enabled));
    button.title = enabled ? 'Turn off car mode' : 'Use larger touchscreen controls';
    sizeTools();
    window.dispatchEvent(new Event('resize'));
  }
  button.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('gregle-maps-car-layout', String(enabled)); } catch {}
    apply();
  });
  apply();
  window.addEventListener('resize', sizeTools);
  if (tools && window.ResizeObserver) new ResizeObserver(sizeTools).observe(tools);
  if (stage && window.ResizeObserver) new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(stage);
})();
