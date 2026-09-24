(() => {
  'use strict';
  const { featured, Directory, Player, MediaControls, localMatches, normalizeStation, mergeStations } = GregleRadio;
  const get = id => document.getElementById(id);
  const countryNames = new Map([["AF","Afghanistan"],["AX","Åland Islands"],["AL","Albania"],["DZ","Algeria"],["AS","American Samoa"],["AD","Andorra"],["AO","Angola"],["AI","Anguilla"],["AQ","Antarctica"],["AG","Antigua & Barbuda"],["AR","Argentina"],["AM","Armenia"],["AW","Aruba"],["AU","Australia"],["AT","Austria"],["AZ","Azerbaijan"],["BS","Bahamas"],["BH","Bahrain"],["BD","Bangladesh"],["BB","Barbados"],["BY","Belarus"],["BE","Belgium"],["BZ","Belize"],["BJ","Benin"],["BM","Bermuda"],["BT","Bhutan"],["BO","Bolivia"],["BA","Bosnia & Herzegovina"],["BW","Botswana"],["BR","Brazil"],["IO","British Indian Ocean Territory"],["VG","British Virgin Islands"],["BN","Brunei"],["BG","Bulgaria"],["BF","Burkina Faso"],["BI","Burundi"],["KH","Cambodia"],["CM","Cameroon"],["CA","Canada"],["CV","Cape Verde"],["BQ","Caribbean Netherlands"],["KY","Cayman Islands"],["CF","Central African Republic"],["TD","Chad"],["CL","Chile"],["CN","China"],["CX","Christmas Island"],["CC","Cocos (Keeling) Islands"],["CO","Colombia"],["KM","Comoros"],["CG","Congo - Brazzaville"],["CD","Congo - Kinshasa"],["CK","Cook Islands"],["CR","Costa Rica"],["CI","Côte d’Ivoire"],["HR","Croatia"],["CU","Cuba"],["CW","Curaçao"],["CY","Cyprus"],["CZ","Czechia"],["DK","Denmark"],["DJ","Djibouti"],["DM","Dominica"],["DO","Dominican Republic"],["EC","Ecuador"],["EG","Egypt"],["SV","El Salvador"],["GQ","Equatorial Guinea"],["ER","Eritrea"],["EE","Estonia"],["SZ","Eswatini"],["ET","Ethiopia"],["FK","Falkland Islands"],["FO","Faroe Islands"],["FJ","Fiji"],["FI","Finland"],["FR","France"],["GF","French Guiana"],["PF","French Polynesia"],["TF","French Southern Territories"],["GA","Gabon"],["GM","Gambia"],["GE","Georgia"],["DE","Germany"],["GH","Ghana"],["GI","Gibraltar"],["GR","Greece"],["GL","Greenland"],["GD","Grenada"],["GP","Guadeloupe"],["GU","Guam"],["GT","Guatemala"],["GG","Guernsey"],["GN","Guinea"],["GW","Guinea-Bissau"],["GY","Guyana"],["HT","Haiti"],["HN","Honduras"],["HK","Hong Kong SAR China"],["HU","Hungary"],["IS","Iceland"],["IN","India"],["ID","Indonesia"],["IR","Iran"],["IQ","Iraq"],["IE","Ireland"],["IM","Isle of Man"],["IL","Israel"],["IT","Italy"],["JM","Jamaica"],["JP","Japan"],["JE","Jersey"],["JO","Jordan"],["KZ","Kazakhstan"],["KE","Kenya"],["KI","Kiribati"],["XK","Kosovo"],["KW","Kuwait"],["KG","Kyrgyzstan"],["LA","Laos"],["LV","Latvia"],["LB","Lebanon"],["LS","Lesotho"],["LR","Liberia"],["LY","Libya"],["LI","Liechtenstein"],["LT","Lithuania"],["LU","Luxembourg"],["MO","Macao SAR China"],["MG","Madagascar"],["MW","Malawi"],["MY","Malaysia"],["MV","Maldives"],["ML","Mali"],["MT","Malta"],["MH","Marshall Islands"],["MQ","Martinique"],["MR","Mauritania"],["MU","Mauritius"],["YT","Mayotte"],["MX","Mexico"],["FM","Micronesia"],["MD","Moldova"],["MC","Monaco"],["MN","Mongolia"],["ME","Montenegro"],["MS","Montserrat"],["MA","Morocco"],["MZ","Mozambique"],["MM","Myanmar (Burma)"],["NA","Namibia"],["NR","Nauru"],["NP","Nepal"],["NL","Netherlands"],["NC","New Caledonia"],["NZ","New Zealand"],["NI","Nicaragua"],["NE","Niger"],["NG","Nigeria"],["NU","Niue"],["KP","North Korea"],["MK","North Macedonia"],["NO","Norway"],["OM","Oman"],["PK","Pakistan"],["PW","Palau"],["PS","Palestinian Territories"],["PA","Panama"],["PG","Papua New Guinea"],["PY","Paraguay"],["PE","Peru"],["PH","Philippines"],["PL","Poland"],["PT","Portugal"],["PR","Puerto Rico"],["QA","Qatar"],["RE","Réunion"],["RO","Romania"],["RU","Russia"],["RW","Rwanda"],["SM","San Marino"],["ST","São Tomé & Príncipe"],["SA","Saudi Arabia"],["SN","Senegal"],["RS","Serbia"],["SC","Seychelles"],["SL","Sierra Leone"],["SG","Singapore"],["SX","Sint Maarten"],["SK","Slovakia"],["SI","Slovenia"],["SB","Solomon Islands"],["SO","Somalia"],["ZA","South Africa"],["KR","South Korea"],["SS","South Sudan"],["ES","Spain"],["LK","Sri Lanka"],["SH","St. Helena"],["KN","St. Kitts & Nevis"],["LC","St. Lucia"],["MF","St. Martin"],["PM","St. Pierre & Miquelon"],["VC","St. Vincent & Grenadines"],["SD","Sudan"],["SR","Suriname"],["SJ","Svalbard & Jan Mayen"],["SE","Sweden"],["CH","Switzerland"],["SY","Syria"],["TW","Taiwan"],["TJ","Tajikistan"],["TZ","Tanzania"],["TH","Thailand"],["TL","Timor-Leste"],["TG","Togo"],["TO","Tonga"],["TT","Trinidad & Tobago"],["TN","Tunisia"],["TR","Türkiye"],["TM","Turkmenistan"],["TC","Turks & Caicos Islands"],["TV","Tuvalu"],["UM","U.S. Outlying Islands"],["VI","U.S. Virgin Islands"],["UG","Uganda"],["UA","Ukraine"],["AE","United Arab Emirates"],["GB","United Kingdom"],["US","United States"],["UY","Uruguay"],["UZ","Uzbekistan"],["VU","Vanuatu"],["VA","Vatican City"],["VE","Venezuela"],["VN","Vietnam"],["WF","Wallis & Futuna"],["XX","XX"],["YE","Yemen"],["ZM","Zambia"],["ZW","Zimbabwe"]]);
  const countryName = code => countryNames.get(code) || code || 'Worldwide';
  for (const [code, name] of countryNames) {
    const option = document.createElement('option'); option.value = code; option.textContent = name;
    get('countryFilter').appendChild(option);
  }
  const directory = new Directory();
  let currentStation = null, currentState = 'stopped';
  function reflectSelection() {
    document.querySelectorAll('.station-card').forEach(card => {
      const selected = card.dataset.station === currentStation?.id;
      card.classList.toggle('is-selected', selected);
      if (selected && currentState === 'playing') card.setAttribute('aria-label', currentStation.name + ', now playing');
      else card.removeAttribute('aria-label');
    });
  }
  const pageTitle = document.title;
  const mediaControls = new MediaControls({
    onPlay: () => player.resume(),
    onPause: () => player.pause(),
    onStop: () => player.stop()
  });
  function refreshNowPlaying() {
    // Set the document title before publishing metadata or starting audio.
    // This also supplies the station name to browsers using their page-title fallback.
    document.title = currentStation && currentState !== 'stopped' && currentState !== 'error' ? currentStation.name : pageTitle;
    mediaControls.update({ station: currentStation, state: currentState });
  }
  document.addEventListener('visibilitychange', refreshNowPlaying);
  window.addEventListener('pageshow', refreshNowPlaying);
  const player = new Player({
    Hls: window.Hls,
    createAudio() {
      const audio = document.createElement('audio'); get('audioHost').replaceChildren(audio); return audio;
    },
    onChange({ state, station, message }) {
      currentStation = station; currentState = state;
      refreshNowPlaying();
      const nowLogo = get('nowLogo');
      nowLogo.hidden = !station?.artwork;
      if (station?.artwork) nowLogo.src = station.artwork.src;
      else nowLogo.removeAttribute('src');
      get('playState').textContent = ({ playing: '● Live', loading: 'Connecting…', paused: 'Paused', stopped: 'Stopped', error: 'Unable to play' })[state];
      get('nowName').textContent = station?.name || 'Choose a station';
      get('nowDetail').textContent = station ? countryName(station.country) + (station.tags ? ' · ' + station.tags : '') : 'Press Play on a station.';
      get('playerStatus').textContent = message || '';
      get('stopPlayback').disabled = state === 'stopped' || state === 'error';
      get('retryPlayback').hidden = !station || (state !== 'error' && state !== 'stopped');
      const website = get('stationWebsite'); website.hidden = !station?.homepage;
      if (station?.homepage) website.href = station.homepage;
      else website.removeAttribute('href');
      reflectSelection();
    }
  });
  function listen(station) { document.title = station.name; player.play(station); directory.recordClick(station); }
  get('stopPlayback').addEventListener('click', () => player.stop());
  get('retryPlayback').addEventListener('click', () => { if (currentStation) listen(currentStation); });
  window.addEventListener('pagehide', () => player.stop());

  function card(station, isFeatured = false) {
    const article = document.createElement('article'); article.className = 'station-card' + (isFeatured ? ' featured' : ''); article.dataset.station = station.id;
    const country = document.createElement('p'); country.className = 'station-country'; country.textContent = countryName(station.country);
    const title = document.createElement('h3'); title.textContent = station.name;
    const tags = document.createElement('p'); tags.className = 'station-tags'; tags.textContent = station.tags || 'Live radio';
    const actions = document.createElement('div'); actions.className = 'station-actions';
    const play = document.createElement('button'); play.className = 'pill' + (isFeatured ? ' primary' : ''); play.type = 'button'; play.textContent = '▶ Play'; play.setAttribute('aria-label', 'Play ' + station.name);
    play.addEventListener('click', () => listen(station)); actions.appendChild(play);
    if (station.homepage) {
      const link = document.createElement('a'); link.href = station.homepage; link.textContent = 'Website ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', station.name + ' website'); actions.appendChild(link);
    }
    if (station.artwork) {
      const logo = document.createElement('img'); logo.className = 'station-logo';
      logo.src = station.artwork.src; logo.alt = ''; logo.width = 80; logo.height = 80;
      article.appendChild(logo);
    }
    article.append(country, title, tags, actions); return article;
  }
  get('featuredStations').querySelectorAll('[data-play-station]').forEach(button => {
    const station = featured.find(item => item.id === button.dataset.playStation);
    if (station) button.addEventListener('click', () => listen(station));
  });
  let results = [], offset = 0, requestNumber = 0, searchController = null, debounce = null, retryAppend = false;
  function render() { get('stationResults').replaceChildren(...results.map(station => card(station))); reflectSelection(); }
  function cancelSearch() {
    ++requestNumber; searchController?.abort(); clearTimeout(debounce);
    get('stationResults').setAttribute('aria-busy', 'false'); get('loadMore').disabled = false;
  }
  function reset() {
    cancelSearch(); get('stationQuery').value = ''; get('countryFilter').value = '';
    results = featured.slice(2); offset = 0; render();
    get('searchStatus').textContent = 'More to try · Choose a country or search the worldwide directory.';
    get('loadMore').hidden = true; get('retrySearch').hidden = true;
  }
  async function search(append = false) {
    cancelSearch(); const request = requestNumber;
    const query = get('stationQuery').value.trim(); const country = get('countryFilter').value;
    if (!append) { offset = 0; results = localMatches(query, country); render(); }
    searchController = new AbortController(); const { signal } = searchController;
    get('stationResults').setAttribute('aria-busy', 'true');
    get('searchStatus').textContent = 'Searching stations…'; get('retrySearch').hidden = true; get('loadMore').disabled = true;
    try {
      const rows = await directory.search(query, country, offset, signal);
      if (request !== requestNumber) return;
      results = mergeStations([...results, ...rows.map(normalizeStation)]);
      offset += rows.length; render();
      get('loadMore').hidden = rows.length < 30;
      get('searchStatus').textContent = results.length ? `${results.length} stations${country ? ' · ' + countryName(country) : ''}${rows.length === 30 ? ' · Load more to keep exploring' : ''}` : 'No playable stations found. Try another name or country.';
    } catch (_) {
      if (request !== requestNumber) return;
      retryAppend = append; get('retrySearch').hidden = false; get('loadMore').hidden = true;
      get('searchStatus').textContent = results.length ? 'The directory is unavailable. You can still play the stations shown, or retry.' : 'The directory is unavailable. Retry, or use a featured station above.';
    } finally {
      if (request === requestNumber) { get('stationResults').setAttribute('aria-busy', 'false'); get('loadMore').disabled = false; }
    }
  }
  get('stationSearch').addEventListener('submit', event => { event.preventDefault(); search(); });
  get('stationQuery').addEventListener('input', () => { cancelSearch(); get('loadMore').hidden = true; debounce = setTimeout(() => search(), 350); });
  get('countryFilter').addEventListener('change', () => search());
  document.querySelectorAll('[data-country]').forEach(button => button.addEventListener('click', () => { get('countryFilter').value = button.dataset.country; search(); }));
  get('loadMore').addEventListener('click', () => search(true));
  get('retrySearch').addEventListener('click', () => search(retryAppend));
  get('resetStations').addEventListener('click', reset);
  reset(); directory.discover();
})();

