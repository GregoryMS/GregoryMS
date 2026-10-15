(() => {
  'use strict';
  const menu = document.getElementById('gregleAppMenu');
  if (!menu?.hasAttribute?.('data-gregle-menu')) return;
  const toggle = menu.querySelector('summary');
  const panel = menu.querySelector('nav');
  const apps = Array.from(menu.querySelectorAll('.gregle-app'));
  const position = () => {
    const top = Math.max(12, Math.min(toggle.getBoundingClientRect().bottom + 12, window.innerHeight - 160));
    menu.style.setProperty('--gregle-menu-top', `${top}px`);
  };
  const close = (restoreFocus = false) => {
    menu.open = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };
  menu.addEventListener('toggle', () => {
    toggle.setAttribute('aria-expanded', String(menu.open));
    if (menu.open) position();
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      close(true);
    }
  });
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget)) close();
  });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menu.open = true;
      position();
      toggle.setAttribute('aria-expanded', 'true');
      apps[0].focus();
    }
  });
  panel.addEventListener('keydown', event => {
    const index = apps.indexOf(event.target);
    if (index < 0) return;
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = apps.length - 1;
    else if (Object.hasOwn(steps, event.key)) next = (index + steps[event.key] + apps.length) % apps.length;
    else return;
    event.preventDefault();
    apps[next].focus();
  });
  window.addEventListener('resize', () => { if (menu.open) position(); });
})();
