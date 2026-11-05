(() => {
  'use strict';
  const navigation = document.querySelector('.astro-navigation');
  const picker = document.getElementById('astro-section-select');
  if (!navigation || !picker) return;
  const links = Array.from(navigation.querySelectorAll('.astro-section-links a'));
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  if (sections.some(section => !section)) return;

  function markCurrent(section) {
    links.forEach((link, index) => {
      if (sections[index] === section) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    // Leave the native menu alone while a keyboard or touch user is choosing.
    if (document.activeElement !== picker) picker.value = section.id;
  }

  function updateCurrent() {
    const offset = matchMedia('(max-width:900px)').matches
      ? navigation.getBoundingClientRect().height + 28 : 48;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= offset) current = section;
      else break;
    }
    markCurrent(current);
  }

  picker.addEventListener('change', () => {
    const section = document.getElementById(picker.value);
    if (!section) return;
    window.location.hash = section.id;
    section.focus({ preventScroll: true });
    markCurrent(section);
  });
  let pending = false;
  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; updateCurrent(); });
  }
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('hashchange', scheduleUpdate);
  window.addEventListener('pageshow', scheduleUpdate);
  picker.addEventListener('blur', scheduleUpdate);
  document.documentElement.classList.add('astro-navigation-ready');
  updateCurrent();
})();
