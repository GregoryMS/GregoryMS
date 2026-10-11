(function () {
  'use strict';
  const host = document.getElementById('currentMoon');
  const name = document.getElementById('currentMoonName');
  const light = document.getElementById('currentMoonLight');
  if (!host || !name || !light) return;
  const phases = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

  function update() {
    if (document.hidden) return;
    try {
      const {phase} = globalThis.SunCalc.getMoonIllumination(new Date());
      if (!Number.isFinite(phase)) throw Error('Moon phase unavailable');
      const normalized = ((phase % 1) + 1) % 1;
      name.textContent = phases[Math.round(normalized * 8) % 8];
      // A conventional phase diagram, matching the astronomy page (not local sky orientation).
      const side = normalized < 0.5 ? 1 : -1;
      const curve = Math.cos(2 * Math.PI * normalized), points = [];
      for (let i = 0; i <= 48; i++) {
        const angle = i * Math.PI / 48;
        points.push([20 + side * 17 * Math.sin(angle), 20 - 17 * Math.cos(angle)]);
      }
      for (let i = 48; i >= 0; i--) {
        const angle = i * Math.PI / 48;
        points.push([20 + side * curve * 17 * Math.sin(angle), 20 - 17 * Math.cos(angle)]);
      }
      light.setAttribute('d', 'M' + points.map(p => p.map(n => n.toFixed(3)).join(',')).join('L') + 'Z');
      host.hidden = false;
    } catch (_) {
      host.hidden = true;
    }
  }

  update();
  setInterval(update, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pageshow', update);
})();
