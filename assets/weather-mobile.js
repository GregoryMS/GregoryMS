/* Keep the main search visible and adapt forecast details to the screen size. */
(() => {
  const nextForecast = document.getElementById('nextForecastDetails');
  const query = document.getElementById('cityQuery');
  const mobile = window.matchMedia('(max-width: 700px)');
  const setLayout = () => {
    nextForecast.open = !mobile.matches;
    query.placeholder = mobile.matches ? 'Find a city' : 'City or postal code';
  };
  setLayout();
  if (mobile.addEventListener) mobile.addEventListener('change', setLayout);
  else mobile.addListener?.(setLayout);
})();
