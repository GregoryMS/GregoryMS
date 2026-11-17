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
    if (button.dataset.scientificAngle) {
      const select = $('graphAngle'); select.value = button.dataset.scientificAngle;
      select.dispatchEvent(new Event('change')); syncAngle();
    } else if (button.dataset.scientificInsert !== undefined) {
      scientific.insert(button.dataset.scientificInsert);
    } else if (button.dataset.scientificAction === 'calculate') scientific.calculate();
    else if (button.dataset.scientificAction === 'clear') scientific.reset();
    else if (button.dataset.scientificAction === 'backspace') scientific.insert('','backspace');
    else if (button.dataset.scientificAction === 'left' || button.dataset.scientificAction === 'right') scientific.navigate(button.dataset.scientificAction);
    else if (button.dataset.scientificAction === 'recall') scientific.recallEntry();
    else if (button.dataset.scientificAction === 'copy') $('copyResult').click();
    else if (button.dataset.scientificAction === 'history') scientific.reset(true);
  });
})();
