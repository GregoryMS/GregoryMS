/* Keep the existing panels and their event handlers; move them only on small screens. */
'use strict';
window.GregleMapDrawer = ({ map }) => {
  const $ = id => document.getElementById(id), stage = document.querySelector('.map-stage');
  const drawer = $('map-drawer'), body = $('map-drawer-body'), tabs = $('map-drawer-tabs');
  const handle = $('map-drawer-resize'), title = $('map-drawer-title'), collapse = $('map-drawer-collapse');
  const media = window.matchMedia('(max-width: 700px)');
  const definitions = [
    ['map-place', 'Place', 'clear-pin'], ['map-search-content', 'Search'],
    ['map-directions', 'Directions', 'close-directions'], ['map-layers-panel', 'Layers', 'close-map-layers'],
    ['map-fuel-card', 'Fuel'], ['vessels-legend', 'Vessel key', 'close-vessels-legend'],
    ['map-feature-details', 'Details'], ['map-link-copy', 'Copy link', 'close-map-link'],
  ];
  let active, rendered, height = 0, expandedHeight = 0, gesture, popupState;
  const popupOptions = new Map();
  const panels = definitions.map(([id, label, close]) => {
    const node = $(id), home = document.createComment(`${id} home`), tab = document.createElement('button');
    node.before(home); tab.type = 'button'; tab.textContent = label;
    tab.setAttribute('aria-controls', id); tab.setAttribute('aria-pressed', 'false');
    tabs.append(tab);
    const entry = { id, label, close, node, home, tab, available: false, dismissed: false };
    tab.addEventListener('click', () => show(id, true));
    return entry;
  });
  const bounds = () => {
    const viewport = window.visualViewport;
    const lift = viewport ? Math.max(0, stage.getBoundingClientRect().bottom - viewport.height - viewport.offsetTop) : 0;
    drawer.style.setProperty('--map-drawer-lift', `${lift}px`);
    return { min: 64, max: Math.max(64, stage.clientHeight - lift - 100) };
  };
  function resize(value) {
    const { min, max } = bounds();
    height = Math.round(Math.max(min, Math.min(max, value)));
    drawer.style.height = `${height}px`;
    const compact = height < 112;
    drawer.classList.toggle('is-compact', compact);
    body.inert = compact;
    handle.setAttribute('aria-valuemin', min); handle.setAttribute('aria-valuemax', max);
    handle.setAttribute('aria-valuenow', height);
    handle.setAttribute('aria-valuetext', `${height} pixels tall${compact ? ', compact' : ''}`);
    collapse.setAttribute('aria-label', compact ? 'Expand map details' : 'Minimize map details');
    collapse.setAttribute('aria-expanded', String(!compact));
    stage.style.setProperty('--map-drawer-height', drawer.hidden ? '0px' : `${height + 24}px`);
  }
  function render() {
    if (!media.matches) return;
    const open = panels.filter(p => p.available);
    if (!open.includes(active)) active = open[0];
    if (rendered !== active) { body.scrollTop = 0; rendered = active; }
    drawer.hidden = !active;
    tabs.hidden = open.length < 2;
    for (const p of panels) {
      p.tab.hidden = !p.available;
      p.tab.setAttribute('aria-pressed', String(p === active));
      p.node.classList.toggle('drawer-active-panel', p === active);
      p.node.inert = p !== active;
    }
    title.textContent = active?.id === 'map-place' ? $('place-name').textContent || 'Place details' : active?.label || 'Map details';
    resize(height || Math.min(320, stage.clientHeight * .42));
  }
  function refresh() {
    if (!media.matches) return;
    let opened;
    for (const p of panels) {
      const visible = !p.node.hidden && !(stage.classList.contains('plugshare-active') && ['map-place', 'map-search-content', 'map-directions', 'map-fuel-card', 'map-feature-details'].includes(p.id));
      if (!visible) p.dismissed = false;
      const available = visible && !p.dismissed;
      if (available && !p.available && (p.id !== 'map-fuel-card' || !active)) opened = p;
      p.available = available;
    }
    if (opened) { active = opened; if (height < 112) height = expandedHeight || 300; }
    render();
  }
  function show(id, reveal = false) {
    if (!media.matches) return;
    const p = panels.find(p => p.id === id);
    if (!p || p.node.hidden) return;
    p.dismissed = false;
    refresh(); active = p;
    if (reveal && height < 112) height = expandedHeight || 300;
    render();
  }
  function minimize() {
    if (height < 112) resize(expandedHeight || 300);
    else { expandedHeight = height; resize(64); }
  }
  function closeActive() {
    if (!active) return;
    const previous = active;
    if (previous.id === 'map-feature-details') map.closePopup();
    else if (previous.close) $(previous.close).click();
    else if (previous.id === 'map-search-content') previous.node.hidden = true;
    else previous.dismissed = true;
    refresh();
    (active ? handle : $('gregle-map')).focus({ preventScroll: true });
  }
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture = { id: event.pointerId, y: event.clientY, height, moved: false };
    handle.setPointerCapture(event.pointerId); drawer.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (Math.abs(event.clientY - gesture.y) > 4) gesture.moved = true;
    if (gesture.moved) resize(gesture.height + gesture.y - event.clientY);
  });
  const finish = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const moved = gesture.moved;
    gesture = null; drawer.classList.remove('is-resizing');
    if (height >= 112) expandedHeight = height;
    if (!moved && event.type === 'pointerup') minimize();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', event => {
    const { min, max } = bounds();
    const values = { ArrowUp: height + 32, ArrowDown: height - 32, PageUp: height + 100, PageDown: height - 100, Home: min, End: max };
    if (event.key in values) { event.preventDefault(); resize(values[event.key]); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); minimize(); }
  });
  collapse.addEventListener('click', minimize);
  $('map-drawer-close').addEventListener('click', closeActive);
  drawer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeActive(); }
  });
  // A focused field must remain reachable above the phone keyboard.
  body.addEventListener('focusin', event => {
    if (event.target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea')) {
      resize(Math.max(height, Math.min(420, bounds().max)));
      event.target.scrollIntoView({ block: 'nearest' });
    }
  });
  function configurePopup(popup) {
    if (!popup || popupOptions.has(popup)) return;
    popupOptions.set(popup, popup.options.autoPan);
    if (media.matches) popup.options.autoPan = false;
  }
  function restorePopup() {
    if (!popupState) return;
    const { node, home } = popupState;
    home.replaceWith(node); popupState = null;
    $('map-feature-details').hidden = true;
  }
  function showPopup(popup) {
    restorePopup();
    if (!media.matches) return;
    const node = popup.getElement()?.querySelector('.leaflet-popup-content');
    if (!node) return;
    const home = document.createComment('popup content home');
    node.before(home); popupState = { node, home, popup };
    $('map-feature-details').append(node); $('map-feature-details').hidden = false;
    show('map-feature-details', true);
  }
  map.on('layeradd', event => configurePopup(event.layer.getPopup?.()));
  map.on('layerremove', event => {
    const p = event.layer.getPopup?.();
    if (popupOptions.has(p)) { p.options.autoPan = popupOptions.get(p); popupOptions.delete(p); }
  });
  map.on('popupopen', event => showPopup(event.popup));
  map.on('popupclose', event => { if (popupState?.popup === event.popup) { restorePopup(); refresh(); } });
  const observer = new MutationObserver(refresh);
  for (const p of panels) observer.observe(p.node, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe($('place-name'), { childList: true, characterData: true, subtree: true });
  observer.observe(stage, { attributes: true, attributeFilter: ['class'] });
  function layout() {
    const focus = document.activeElement;
    if (!media.matches) restorePopup();
    for (const p of panels) {
      if (media.matches) body.append(p.node);
      else { p.home.after(p.node); p.node.classList.remove('drawer-active-panel'); p.node.inert = false; p.available = false; }
    }
    stage.classList.toggle('has-mobile-drawer', media.matches);
    for (const [popup, autoPan] of popupOptions) popup.options.autoPan = media.matches ? false : autoPan;
    if (!media.matches) { drawer.hidden = true; stage.style.removeProperty('--map-drawer-height'); }
    else refresh();
    if (focus && focus !== document.body && focus.isConnected && !focus.closest('[inert]')) focus.focus({ preventScroll: true });
  }
  media.addEventListener('change', layout);
  new ResizeObserver(() => { if (media.matches) resize(height); }).observe(stage);
  window.visualViewport?.addEventListener('resize', () => { if (media.matches) resize(height); });
  window.visualViewport?.addEventListener('scroll', () => { if (media.matches) resize(height); });
  layout();
  return { show };
};
