(() => {
  'use strict';
  const menu = document.getElementById('gregleAppMenu');
  if (!menu?.hasAttribute?.('data-gregle-menu')) return;
  const toggle = menu.querySelector('summary');
  const panel = menu.querySelector('nav');
  const grid = menu.querySelector('.gregle-app-grid');
  const status = menu.querySelector('[data-gregle-app-status]');
  const orderKey = 'gregle-app-order';
  const apps = () => Array.from(grid.querySelectorAll('.gregle-app'));
  const appId = app => app.getAttribute('data-gregle-app-id') || app.getAttribute('href');
  const appAt = target => {
    const app = target?.closest?.('.gregle-app');
    return app?.parentElement === grid ? app : null;
  };
  const saveOrder = () => {
    try { localStorage.setItem(orderKey, JSON.stringify(apps().map(appId))); } catch {}
  };
  const restoreOrder = saved => {
    if (!Array.isArray(saved)) return;
    const remaining = new Map(apps().map(app => [appId(app), app]));
    for (const id of saved) {
      if (!remaining.has(id)) continue;
      grid.append(remaining.get(id));
      remaining.delete(id);
    }
    for (const app of remaining.values()) grid.append(app);
  };
  try { restoreOrder(JSON.parse(localStorage.getItem(orderKey))); } catch {}
  for (const app of apps()) {
    app.draggable = true;
    app.setAttribute('aria-describedby', 'gregleAppHelp');
    app.title = 'Drag to rearrange; hold on touch screens. Alt + arrow keys also moves this app.';
    app.querySelector('img').draggable = false;
  }
  const announce = app => {
    if (status) status.textContent = `${app.textContent.trim()} moved to position ${apps().indexOf(app) + 1} of ${apps().length}.`;
  };
  let drag = null, touch = null, frame = 0, suppressClickUntil = 0;
  const beginDrag = (app, x, y, isTouch = false) => {
    drag = { app, original: apps(), x, y, isTouch, preview: null };
    app.classList.add('gregle-app-dragging');
    if (isTouch) {
      const rect = app.getBoundingClientRect();
      const preview = app.cloneNode(true);
      preview.classList.remove('gregle-app-dragging');
      preview.classList.add('gregle-drag-preview');
      preview.setAttribute('aria-hidden', 'true');
      preview.tabIndex = -1;
      preview.removeAttribute('href');
      preview.style.width = `${rect.width}px`;
      preview.style.height = `${rect.height}px`;
      menu.append(preview);
      drag.preview = preview;
      drag.offsetX = x - rect.left;
      drag.offsetY = y - rect.top;
    }
  };
  const finishDrag = commit => {
    if (!drag) return;
    const { app, original, preview } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    app.classList.remove('gregle-app-dragging');
    preview?.remove();
    if (commit) { saveOrder(); announce(app); }
    else for (const item of original) grid.append(item);
    suppressClickUntil = Date.now() + 400;
  };
  const clearTouch = () => {
    if (touch) clearTimeout(touch.timer);
    touch = null;
  };
  const reorderAtPointer = () => {
    if (!drag) return;
    const rect = grid.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top || drag.y > rect.bottom) return;
    const target = appAt(document.elementFromPoint(drag.x, drag.y));
    if (!target || target === drag.app) return;
    const ordered = apps();
    if (ordered.indexOf(drag.app) < ordered.indexOf(target)) target.after(drag.app);
    else target.before(drag.app);
  };
  const scrollSpeed = () => {
    if (!drag) return 0;
    const rect = grid.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top - 8 || drag.y > rect.bottom + 8) return 0;
    const edge = Math.min(40, rect.height / 3);
    if (drag.y < rect.top + edge && grid.scrollTop > 0) return -8;
    if (drag.y > rect.bottom - edge && grid.scrollTop + grid.clientHeight < grid.scrollHeight) return 8;
    return 0;
  };
  const autoScroll = () => {
    frame = 0;
    const speed = scrollSpeed();
    if (!speed) return;
    grid.scrollTop += speed;
    reorderAtPointer();
    frame = requestAnimationFrame(autoScroll);
  };
  const moveDrag = (x, y) => {
    if (!drag) return;
    drag.x = x; drag.y = y;
    if (drag.preview) {
      drag.preview.style.left = `${x - drag.offsetX}px`;
      drag.preview.style.top = `${y - drag.offsetY}px`;
    }
    reorderAtPointer();
    if (!frame && scrollSpeed()) frame = requestAnimationFrame(autoScroll);
  };
  grid.addEventListener('dragstart', event => {
    const app = appAt(event.target);
    if (!app) return;
    clearTouch();
    beginDrag(app, event.clientX, event.clientY);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', app.getAttribute('href'));
  });
  document.addEventListener('dragover', event => {
    if (!drag || drag.isTouch) return;
    moveDrag(event.clientX, event.clientY);
    if (grid.contains(event.target)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  });
  grid.addEventListener('drop', event => {
    if (!drag || drag.isTouch) return;
    event.preventDefault();
    finishDrag(true);
  });
  grid.addEventListener('dragend', () => finishDrag(false));
  grid.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { clearTouch(); finishDrag(false); return; }
    const app = appAt(event.target);
    if (!app) return;
    const point = event.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY, timer: 0 };
    touch.timer = setTimeout(() => {
      beginDrag(app, touch.x, touch.y, true);
      moveDrag(touch.x, touch.y);
    }, 450);
  }, { passive: true });
  grid.addEventListener('touchmove', event => {
    if (!touch) return;
    const point = Array.from(event.touches).find(point => point.identifier === touch.id);
    if (!point) return;
    if (drag?.isTouch) {
      event.preventDefault();
      moveDrag(point.clientX, point.clientY);
    } else if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 10) clearTouch();
  }, { passive: false });
  grid.addEventListener('touchend', event => {
    if (drag?.isTouch) {
      event.preventDefault();
      const rect = grid.getBoundingClientRect();
      finishDrag(drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom);
    }
    clearTouch();
  }, { passive: false });
  grid.addEventListener('touchcancel', () => { clearTouch(); finishDrag(false); });
  grid.addEventListener('contextmenu', event => { if (touch || drag) event.preventDefault(); });
  grid.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  const position = () => {
    const top = Math.max(12, Math.min(toggle.getBoundingClientRect().bottom + 12, window.innerHeight - 160));
    menu.style.setProperty('--gregle-menu-top', `${top}px`);
  };
  const close = (restoreFocus = false) => {
    clearTouch(); finishDrag(false);
    menu.open = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };
  menu.addEventListener('toggle', () => {
    toggle.setAttribute('aria-expanded', String(menu.open));
    if (menu.open) position();
    else { clearTouch(); finishDrag(false); }
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
    if (!drag && event.relatedTarget && !menu.contains(event.relatedTarget)) close();
  });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menu.open = true;
      position();
      toggle.setAttribute('aria-expanded', 'true');
      apps()[0]?.focus();
    }
  });
  panel.addEventListener('keydown', event => {
    const ordered = apps();
    const index = ordered.indexOf(event.target);
    if (index < 0 || event.ctrlKey || event.metaKey) return;
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
    let next;
    if (event.altKey && Object.hasOwn(steps, event.key)) {
      event.preventDefault();
      next = Math.max(0, Math.min(ordered.length - 1, index + steps[event.key]));
      if (next === index) return;
      if (next > index) ordered[next].after(event.target);
      else ordered[next].before(event.target);
      event.target.focus();
      event.target.scrollIntoView({ block: 'nearest' });
      saveOrder(); announce(event.target);
      return;
    }
    if (event.altKey) return;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ordered.length - 1;
    else if (Object.hasOwn(steps, event.key)) next = (index + steps[event.key] + ordered.length) % ordered.length;
    else return;
    event.preventDefault();
    ordered[next].focus();
  });
  window.addEventListener('resize', () => { if (menu.open) position(); });
  window.addEventListener('storage', event => {
    if (event.key !== orderKey || drag) return;
    try { restoreOrder(JSON.parse(event.newValue)); } catch {}
  });
})();
