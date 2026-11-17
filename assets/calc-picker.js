/* The picker delegates switching and session saving to the existing TI controls. */
(() => {
  'use strict';
  const picker = document.getElementById('calculatorEngine');
  const buttons = {
    ti84:document.getElementById('emulatorOpen'),
    ti89:document.getElementById('ti89Open'),
    tinspire:document.getElementById('tinspireOpen')
  };
  // Select controls can match :focus-visible after touch on iOS; track the actual input method.
  picker.addEventListener('pointerdown',() => picker.classList.add('pointer-focused'));
  picker.addEventListener('keydown',() => picker.classList.remove('pointer-focused'));
  picker.addEventListener('blur',() => picker.classList.remove('pointer-focused'));
  let requested = null;
  const selected = () => Object.keys(buttons).find(engine => buttons[engine].getAttribute('aria-checked') === 'true') || 'scientific';
  function sync() {
    const engine = selected();
    if (requested === engine) requested = null;
    picker.value = engine;
    picker.disabled = requested !== null || Object.values(buttons).some(button => button.disabled);
  }
  const observer = new MutationObserver(sync);
  Object.values(buttons).forEach(button => observer.observe(button,{attributes:true,attributeFilter:['aria-checked','disabled']}));
  picker.addEventListener('change',() => {
    const engine = picker.value, current = selected();
    if (engine === current) return;
    requested = engine; picker.disabled = true;
    // Clicking the active TI control returns to the native calculator and saves its session.
    const button = engine === 'scientific' ? buttons[current] : buttons[engine];
    if (button && !button.disabled) button.click();
    else requested = null;
    sync();
  });
  sync();
})();
