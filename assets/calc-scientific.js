(() => {
  'use strict';
  const $ = id => document.getElementById(id), scientific = window.GregleScientific;
  const controls = $('scientificControls');
  // The native calculator always opens on calculation, including old graph bookmarks.
  window.GregleCalculator.openScreen('calculate',false);
  const angleButtons = controls.querySelectorAll('[data-scientific-angle]');
  function syncAngle() {
    const angle = scientific.getState().angle;
    angleButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.scientificAngle === angle)));
  }
  const shiftedKeys = controls.querySelectorAll('[data-shift-insert]');
  let shifted = false;
  shiftedKeys.forEach(button => {
    button.dataset.primaryInsert = button.dataset.scientificInsert;
    button.dataset.primaryLabel = button.querySelector('[data-key-label]').textContent;
    button.dataset.primaryAria = button.getAttribute('aria-label');
    const hint = document.createElement('small'); hint.className = 'shift-hint'; hint.setAttribute('aria-hidden','true');
    hint.textContent = button.dataset.shiftLabel; button.prepend(hint);
  });
  function setShift(value) {
    shifted = value; $('scientificShift').setAttribute('aria-pressed',String(value));
    shiftedKeys.forEach(button => {
      button.dataset.scientificInsert = value ? button.dataset.shiftInsert : button.dataset.primaryInsert;
      button.querySelector('[data-key-label]').textContent = value ? button.dataset.shiftLabel : button.dataset.primaryLabel;
      button.querySelector('.shift-hint').textContent = value ? button.dataset.primaryLabel : button.dataset.shiftLabel;
      button.setAttribute('aria-label',value ? button.dataset.shiftAria : button.dataset.primaryAria);
    });
  }
  syncAngle();
  // Preserve the expression selection when tapping a key on a phone.
  controls.addEventListener('pointerdown',event => {
    if (event.target.closest('button') && event.isPrimary !== false) event.preventDefault();
  });
  controls.addEventListener('click',event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (event.isTrusted && event.detail > 0 && typeof navigator.vibrate === 'function') {
      try {navigator.vibrate(8);} catch (_) {}
    }
    if (button.dataset.scientificAction === 'shift') {setShift(!shifted); return;}
    if (button.dataset.scientificAngle) {
      const select = $('graphAngle'); select.value = button.dataset.scientificAngle;
      select.dispatchEvent(new Event('change')); syncAngle();
    } else if (button.dataset.scientificInsert !== undefined) {
      scientific.insert(button.dataset.scientificInsert);
    } else if (button.dataset.scientificAction === 'calculate') scientific.calculate();
    else if (button.dataset.scientificAction === 'clear') scientific.reset();
    else if (button.dataset.scientificAction === 'backspace') scientific.insert('','backspace');
    else if (['left','right','up','down','enter'].includes(button.dataset.scientificAction)) scientific.navigate(button.dataset.scientificAction);
    else if (button.dataset.scientificAction === 'recall') scientific.recallEntry();
    else if (button.dataset.scientificAction === 'copy') $('copyResult').click();
    else if (button.dataset.scientificAction === 'history') scientific.reset(true);
    else if (button.dataset.scientificAction === 'fraction') scientific.insertFraction();
    else if (button.dataset.scientificAction === 'format') scientific.toggleFraction();
    else if (button.dataset.scientificAction === 'exponent') scientific.insert(scientific.getState().expression ? '×10^(' : '10^(');
    if (shifted) setShift(false);
  });
})();
