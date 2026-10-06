(() => {
  'use strict';
  const root = document.documentElement;
  const toggle = document.getElementById('night-vision-toggle');
  const clock = document.getElementById('utc-clock');
  const localClock = document.getElementById('local-clock');
  const storageKey = 'gregle-astro-night-vision';

  function applyNightVision(enabled) {
    root.classList.toggle('night-vision', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.title = enabled ? 'Turn off night vision' : 'Turn on night vision';
  }

  let enabled = false;
  try { enabled = localStorage.getItem(storageKey) === 'true'; } catch (_) {}
  applyNightVision(enabled);
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    enabled = !root.classList.contains('night-vision');
    applyNightVision(enabled);
    try { localStorage.setItem(storageKey, String(enabled)); } catch (_) {}
  });

  function updateClock() {
    const now = new Date();
    const iso = now.toISOString();
    clock.textContent = iso.slice(11, 19);
    clock.dateTime = iso;
    clock.title = `${iso.slice(0, 10)} UTC`;
    // Local Date getters follow the viewer's device time zone, including DST.
    localClock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => String(value).padStart(2, '0')).join(':');
    localClock.dateTime = iso;
    localClock.title = `${now.toLocaleDateString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  }
  // Read the current time on every tick, so background throttling cannot cause drift.
  updateClock();
  window.setInterval(updateClock, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClock();
  });
  window.addEventListener('pageshow', updateClock);
})();
