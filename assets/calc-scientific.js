(() => {
  'use strict';
  const $ = id => document.getElementById(id), scientific = window.GregleScientific;
  const controls = $('scientificControls');
  const page = $('calcPage'), menu = $('scientificMenu'), menuButton = $('scientificMenuOpen');
  const themeKey = 'gregle-calc-scientific-theme';
  const themeOptions = Array.from(menu.querySelectorAll('input[name="scientific-theme"]'));

  try {
    const value = localStorage.getItem(themeKey);
    const saved = themeOptions.find(option => option.value === value);
    if (saved) {
      saved.checked = true;
      page.dataset.scientificTheme = saved.value;
    }
  } catch (_) {}
  menu.addEventListener('change', event => {
    if (!themeOptions.includes(event.target)) return;
    const {value} = event.target;
    page.dataset.scientificTheme = value;
    try {localStorage.setItem(themeKey,value);} catch (_) {}
  });
  menu.addEventListener('keydown', event => event.stopPropagation());
  let menuOpenedWithPointer = false;
  menu.addEventListener('close', () => {
    if (!menuOpenedWithPointer) menuButton.focus({preventScroll:true});
    else if (document.activeElement === menuButton) menuButton.blur();
  });
  // The native calculator always opens on calculation, including old graph bookmarks.
  window.GregleCalculator.openScreen('calculate',false);
  const angleButtons = controls.querySelectorAll('[data-scientific-angle]');
  function syncAngle() {
    const angle = scientific.getState().angle;
    angleButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.scientificAngle === angle)));
  }
  const shiftedKeys = controls.querySelectorAll('[data-shift-label]');
  let shifted = false;
  shiftedKeys.forEach(button => {
    if (button.dataset.shiftInsert !== undefined) button.dataset.primaryInsert = button.dataset.scientificInsert;
    button.dataset.primaryLabel = button.querySelector('[data-key-label]').textContent;
    button.dataset.primaryAria = button.getAttribute('aria-label');
    const hint = document.createElement('small'); hint.className = 'shift-hint'; hint.setAttribute('aria-hidden','true');
    hint.textContent = button.dataset.shiftLabel; button.prepend(hint);
  });
  function setShift(value) {
    shifted = value; $('scientificShift').setAttribute('aria-pressed',String(value));
    shiftedKeys.forEach(button => {
      if (button.dataset.shiftInsert !== undefined) {
        button.dataset.scientificInsert = value ? button.dataset.shiftInsert : button.dataset.primaryInsert;
      }
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
    else if (button.dataset.scientificAction === 'clear') scientific.reset(shifted);
    else if (button.dataset.scientificAction === 'backspace') scientific.insert('','backspace');
    else if (['left','right','up','down','enter'].includes(button.dataset.scientificAction)) scientific.navigate(button.dataset.scientificAction);
    else if (button.dataset.scientificAction === 'recall') scientific.recallEntry();
    else if (button.dataset.scientificAction === 'copy') $('copyResult').click();
    else if (button.dataset.scientificAction === 'menu') {
      menuOpenedWithPointer = event.detail > 0;
      menu.showModal();
    }
    else if (button.dataset.scientificAction === 'fraction') scientific.insertFraction();
    else if (button.dataset.scientificAction === 'format') scientific.toggleFraction();
    else if (button.dataset.scientificAction === 'exponent') scientific.insert(scientific.getState().expression ? '×10^(' : '10^(');
    if (shifted) setShift(false);
  });
})();
