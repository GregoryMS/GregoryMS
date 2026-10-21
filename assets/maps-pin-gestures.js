(function (root) {
  'use strict';

  function pinGestures({ container, onPin }) {
    const doubleTapDelay = 450, tapDistance = 32, moveTolerance = 15, holdDelay = 550;
    const excluded = '.leaflet-interactive, .leaflet-popup, .leaflet-control';
    let previous = null, gesture = null, holdTimer, lastTouch = -Infinity;
    const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const cancel = () => { clearTimeout(holdTimer); gesture = null; previous = null; };
    const point = touch => ({ clientX: touch.clientX, clientY: touch.clientY, target: touch.target });

    container.addEventListener('touchstart', event => {
      lastTouch = Date.now();
      clearTimeout(holdTimer);
      if (event.touches.length !== 1 || event.target?.closest?.(excluded)) { cancel(); return; }
      const touch = event.touches[0];
      gesture = { ...point(touch), target: event.target, id: touch.identifier, started: lastTouch, held: false };
      holdTimer = setTimeout(() => {
        if (!gesture) return;
        gesture.held = true;
        previous = null;
        onPin(gesture);
      }, holdDelay);
    }, { passive: true });

    container.addEventListener('touchmove', event => {
      lastTouch = Date.now();
      const touch = Array.from(event.touches).find(touch => touch.identifier === gesture?.id);
      if (event.touches.length !== 1 || !touch || distance(gesture, touch) > moveTolerance) cancel();
    }, { passive: true });

    container.addEventListener('touchend', event => {
      lastTouch = Date.now();
      clearTimeout(holdTimer);
      const ended = gesture;
      gesture = null;
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === ended?.id);
      if (!ended || !touch || event.touches.length || distance(ended, touch) > moveTolerance) { previous = null; return; }
      if (ended.held) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (lastTouch - ended.started > 350) { previous = null; return; }
      if (previous && lastTouch - previous.time <= doubleTapDelay && distance(previous, touch) <= tapDistance) {
        previous = null;
        // Stop the compatibility click/dblclick from placing the same pin twice.
        if (event.cancelable) event.preventDefault();
        onPin({ ...point(touch), target: ended.target });
      } else {
        previous = { ...point(touch), time: lastTouch };
      }
    }, { passive: false });

    container.addEventListener('touchcancel', () => { lastTouch = Date.now(); cancel(); }, { passive: true });
    container.addEventListener('contextmenu', event => {
      if (Date.now() - lastTouch < 800 && event.cancelable && !event.target?.closest?.(excluded)) event.preventDefault();
    });

    return {
      ignoreDoubleClick(event) {
        if (event?.pointerType === 'mouse' || event?.sourceCapabilities?.firesTouchEvents === false) return false;
        return Date.now() - lastTouch < 800;
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = pinGestures;
  else root.GregleMapPinGestures = pinGestures;
})(typeof window !== 'undefined' ? window : globalThis);
