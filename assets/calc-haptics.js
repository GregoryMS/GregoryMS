/* Safari exposes switch haptics instead of the Vibration API.
   A real tap must activate the switch; calling click() from JS is insufficient.
   Keep the original buttons available to keyboards and assistive technology. */
(() => {
  'use strict';
  if (typeof navigator.vibrate === 'function') return;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || !('switch' in document.createElement('input'))) return;
  document.querySelectorAll('#scientificControls button').forEach(button => {
    const surface = document.createElement('label');
    surface.className = 'scientific-haptic-surface';
    surface.setAttribute('aria-hidden','true');
    Object.assign(surface.style,{position:'absolute',inset:'0',borderRadius:'inherit',touchAction:'manipulation'});
    const pulse = document.createElement('input');
    pulse.type = 'checkbox'; pulse.setAttribute('switch',''); pulse.tabIndex = -1;
    Object.assign(pulse.style,{position:'absolute',width:'1px',height:'1px',margin:'0',visibility:'hidden',pointerEvents:'none'});
    // The label's forwarded activation must not enter the calculation twice.
    pulse.addEventListener('click',event => event.stopPropagation());
    surface.append(pulse); button.style.position = 'relative'; button.append(surface);
  });
})();
