const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  let now = 1000, nextTimer = 0;
  const listeners = {}, timers = new Map(), pins = [];
  const container = {addEventListener(type, fn, options) {listeners[type] = {fn, options};}};
  const context = {module: {exports: {}}, Date: {now: () => now},
    setTimeout(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, at: now + delay}); return id;},
    clearTimeout(id) {timers.delete(id);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-pin-gestures.js'), 'utf8'), context);
  const api = context.module.exports({container, onPin: point => pins.push(point)});
  const target = {closest: () => null};
  const touch = (x = 100, y = 200, identifier = 1) => ({clientX: x, clientY: y, identifier, target});
  function fire(type, touches, changedTouches = touches, eventTarget = target) {
    const event = {touches, changedTouches, target: eventTarget, cancelable: true, prevented: false,
      preventDefault() {this.prevented = true;}};
    listeners[type].fn(event);
    return event;
  }
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();}
  }
  function tap(x = 100, y = 200, duration = 60) {
    const finger = touch(x, y);
    const start = fire('touchstart', [finger]);
    advance(duration);
    const end = fire('touchend', [], [finger]);
    return {start, end};
  }
  return {api, listeners, pins, target, touch, fire, advance, tap};
}

test('slower double taps with normal finger imprecision place one pin at the second tap', () => {
  const h = setup();
  assert(!h.tap().end.prevented);
  h.advance(300);
  const second = h.tap(120, 212);
  assert.equal(h.pins.length, 1);
  assert.equal(h.pins[0].clientX, 120);
  assert.equal(h.pins[0].clientY, 212);
  assert(second.end.prevented);
  assert(h.api.ignoreDoubleClick({detail: 2, _simulated: true}));
  assert(h.api.ignoreDoubleClick({sourceCapabilities: {firesTouchEvents: true}}));
  h.tap(121, 211);
  assert.equal(h.pins.length, 1, 'a third tap must not repeat the placement');
});

test('single taps, unrelated taps and taps too far apart do not drop a pin', () => {
  for (const run of [h => h.tap(), h => {h.tap(); h.advance(500); h.tap();}, h => {h.tap(); h.tap(160, 200);}]) {
    const h = setup(); run(h); h.advance(1000);
    assert.equal(h.pins.length, 0);
  }
});

test('short finger drift is tolerated, but panning never turns into a tap or a hold', () => {
  const h = setup(), finger = h.touch();
  assert(!h.fire('touchstart', [finger]).prevented);
  h.advance(50);
  assert(!h.fire('touchmove', [h.touch(110, 204)]).prevented);
  h.fire('touchend', [], [h.touch(110, 204)]);
  h.advance(250); h.tap(112, 206);
  assert.equal(h.pins.length, 1);
  const drag = setup(); drag.tap();
  drag.fire('touchstart', [finger]);
  assert(!drag.fire('touchmove', [drag.touch(160, 200)]).prevented);
  drag.fire('touchmove', [finger]);
  drag.advance(700);
  assert(!drag.fire('touchend', [], [finger]).prevented);
  assert.equal(drag.pins.length, 0, 'moving back to the start must not revive a cancelled gesture');
});

test('pinch zoom, interrupted touches and map controls cannot drop a pin', () => {
  for (const cancel of [
    h => h.fire('touchcancel', [], [h.touch()]),
    h => {h.fire('touchstart', [h.touch(), h.touch(140, 200, 2)]); h.fire('touchend', [h.touch()], [h.touch(140, 200, 2)]);},
    h => h.fire('touchmove', [h.touch(), h.touch(140, 200, 2)]),
  ]) {
    const h = setup(); h.tap(); h.fire('touchstart', [h.touch()]); cancel(h); h.advance(700);
    h.fire('touchend', [], [h.touch()]); h.tap();
    assert.equal(h.pins.length, 0);
  }
  for (const name of ['.leaflet-control', '.leaflet-interactive', '.leaflet-popup']) {
    const h = setup(); h.tap();
    const target = {closest: selector => selector.includes(name) ? {} : null};
    h.fire('touchstart', [h.touch()], undefined, target); h.advance(600);
    h.fire('touchend', [], [h.touch()]);
    assert.equal(h.pins.length, 0, name);
  }
});

test('touch and hold places once, cancels the callout and does not repeat on release', () => {
  const h = setup(), finger = h.touch();
  h.fire('touchstart', [finger]); h.advance(549);
  assert.equal(h.pins.length, 0);
  assert(h.fire('contextmenu', [], []).prevented);
  h.advance(1);
  assert.equal(h.pins.length, 1);
  h.advance(1000);
  assert(h.fire('touchend', [], [finger]).prevented);
  assert.equal(h.pins.length, 1);
  assert(h.api.ignoreDoubleClick({}));
});

test('desktop double-clicks stay available and touch listeners preserve native pan and zoom', () => {
  const h = setup();
  assert(!h.api.ignoreDoubleClick({}));
  assert(!h.fire('contextmenu', [], []).prevented);
  h.tap();
  assert(!h.api.ignoreDoubleClick({pointerType: 'mouse'}));
  assert(!h.api.ignoreDoubleClick({sourceCapabilities: {firesTouchEvents: false}}));
  h.advance(801);
  assert(!h.api.ignoreDoubleClick({}));
  assert.equal(h.listeners.touchstart.options.passive, true);
  assert.equal(h.listeners.touchmove.options.passive, true);
  assert.equal(h.listeners.touchend.options.passive, false);
});
