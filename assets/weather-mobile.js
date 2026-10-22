/* Keep the forecast close to the top on phones; native details remains usable without JS. */
(() => {
  const picker = document.getElementById('locationPicker');
  const nextForecast = document.getElementById('nextForecastDetails');
  const mobile = window.matchMedia('(max-width: 700px)');
  const setLayout = () => {
    picker.open = !mobile.matches;
    nextForecast.open = !mobile.matches;
  };
  setLayout();
  if (mobile.addEventListener) mobile.addEventListener('change', setLayout);
  else mobile.addListener?.(setLayout);
})();
