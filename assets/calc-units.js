/* Search and convert units within the scientific calculator menu. */
(() => {
  'use strict';
  const foot = 0.3048, mile = 1609.344, pound = 0.45359237;
  const usGallon = 3.785411784, imperialGallon = 4.54609;
  const gravity = 9.80665, poundForce = pound*gravity, footPound = foot*poundForce;
  const degree = Math.PI/180, au = 149597870700;
  const currencies = [
    ['Canadian dollar','CAD'], ['US dollar','USD'], ['Euro','EUR'], ['British pound','GBP'],
    ['Norwegian krone','NOK'], ['Swedish krona','SEK'], ['Swiss franc','CHF'], ['Japanese yen','JPY'],
    ['Australian dollar','AUD'], ['New Zealand dollar','NZD'], ['Danish krone','DKK'],
    ['Polish złoty','PLN'], ['Mexican peso','MXN'], ['Indian rupee','INR'], ['Chinese yuan','CNY']
  ];

  // Each unit is [name, symbol, multiplier to base, optional offset or 'reciprocal'].
  const groups = [
    ['Dimensions', [
      ['length','Length',[
        ['Kilometre','km',1000], ['Mile','mi',mile], ['Metre','m',1], ['Centimetre','cm',0.01],
        ['Millimetre','mm',0.001], ['Micrometre','µm',1e-6], ['Nanometre','nm',1e-9],
        ['Inch','in',0.0254], ['Foot','ft',foot], ['Yard','yd',0.9144], ['Nautical mile','nmi',1852]
      ]],
      ['area','Area',[
        ['Hectare','ha',10000], ['Acre','ac',43560*foot**2], ['Square metre','m²',1], ['Square kilometre','km²',1e6],
        ['Square centimetre','cm²',1e-4], ['Square foot','ft²',foot**2], ['Square inch','in²',0.0254**2], ['Square mile','mi²',mile**2]
      ]],
      ['volume','Volume',[
        ['Litre','L',1], ['US gallon','US gal',usGallon], ['Imperial gallon','imp gal',imperialGallon],
        ['Millilitre','mL',0.001], ['Cubic metre','m³',1000], ['Cubic centimetre','cm³',0.001],
        ['US fluid ounce','US fl oz',usGallon/128], ['Imperial fluid ounce','imp fl oz',imperialGallon/160],
        ['US cup','US cup',usGallon/16], ['US tablespoon','US tbsp',usGallon/256], ['US teaspoon','US tsp',usGallon/768],
        ['Oil barrel','bbl',42*usGallon]
      ]]
    ]],
    ['Useful', [
      ['currency','Currency',currencies],
      ['fuel','Fuel consumption',[
        ['Litres per 100 kilometres','L/100 km',1], ['Miles per US gallon','US mpg',100000*usGallon/mile,'reciprocal'],
        ['Miles per Imperial gallon','imp mpg',100000*imperialGallon/mile,'reciprocal'],
        ['Kilometres per litre','km/L',100,'reciprocal']
      ]],
      ['time','Time',[
        ['Hour','h',3600], ['Minute','min',60], ['Second','s',1], ['Millisecond','ms',0.001],
        ['Day','d',86400], ['Week','wk',604800]
      ]]
    ]],
    ['Mechanics', [
      ['pressure','Pressure',[
        ['Kilopascal','kPa',1000], ['Pound per square inch','psi',poundForce/0.0254**2], ['Pascal','Pa',1],
        ['Hectopascal','hPa',100], ['Bar','bar',100000], ['Standard atmosphere','atm',101325], ['Torr','Torr',101325/760]
      ]],
      ['mass','Mass (weight)',[
        ['Kilogram','kg',1], ['Pound','lb',pound], ['Gram','g',0.001], ['Milligram','mg',1e-6],
        ['Metric tonne','t',1000], ['Ounce','oz',pound/16], ['Stone','st',14*pound],
        ['US short ton','US ton',2000*pound], ['Imperial long ton','imp ton',2240*pound]
      ]],
      ['force','Force',[
        ['Newton','N',1], ['Pound-force','lbf',poundForce], ['Kilonewton','kN',1000], ['Kilogram-force','kgf',gravity], ['Dyne','dyn',1e-5]
      ]],
      ['torque','Torque',[
        ['Newton metre','N·m',1], ['Pound-force foot','lbf·ft',footPound], ['Pound-force inch','lbf·in',poundForce*0.0254],
        ['Kilogram-force metre','kgf·m',gravity]
      ]]
    ]],
    ['Motion', [
      ['speed','Speed',[
        ['Kilometre per hour','km/h',1/3.6], ['Mile per hour','mph',mile/3600], ['Metre per second','m/s',1],
        ['Foot per second','ft/s',foot], ['Knot','kn',1852/3600]
      ]],
      ['acceleration','Acceleration',[
        ['Metre per second squared','m/s²',1], ['Standard gravity','g₀',gravity], ['Foot per second squared','ft/s²',foot]
      ]],
      ['angular-speed','Angular speed',[
        ['Revolution per minute','rpm',2*Math.PI/60], ['Radian per second','rad/s',1],
        ['Degree per second','°/s',degree], ['Revolution per second','r/s',2*Math.PI]
      ]],
      ['flow','Flow rate',[
        ['Litre per minute','L/min',1/60000], ['US gallon per minute','US gal/min',usGallon/60000],
        ['Imperial gallon per minute','imp gal/min',imperialGallon/60000], ['Cubic metre per second','m³/s',1],
        ['Cubic foot per minute','ft³/min',foot**3/60], ['Litre per second','L/s',0.001]
      ]],
      ['frequency','Frequency',[
        ['Hertz','Hz',1], ['Kilohertz','kHz',1000], ['Megahertz','MHz',1e6], ['Gigahertz','GHz',1e9]
      ]]
    ]],
    ['Chemistry', [
      ['density','Density',[
        ['Kilogram per cubic metre','kg/m³',1], ['Gram per millilitre','g/mL',1000],
        ['Kilogram per litre','kg/L',1000], ['Pound per cubic foot','lb/ft³',pound/foot**3],
        ['Ounce per US gallon','oz/US gal',(pound/16)/(usGallon/1000)]
      ]],
      ['dynamic-viscosity','Dynamic viscosity',[
        ['Pascal second','Pa·s',1], ['Centipoise','cP',0.001], ['Millipascal second','mPa·s',0.001], ['Poise','P',0.1]
      ]],
      ['kinematic-viscosity','Kinematic viscosity',[
        ['Square metre per second','m²/s',1], ['Centistokes','cSt',1e-6], ['Stokes','St',1e-4],
        ['Square millimetre per second','mm²/s',1e-6]
      ]],
      ['concentration','Concentration ratios',[
        ['Parts per million','ppm',1e-6], ['Percent','%',0.01], ['Parts per thousand','‰',0.001],
        ['Parts per billion','ppb',1e-9], ['Fraction','1',1]
      ]]
    ]],
    ['Computing', [
      ['storage','Data storage',[
        ['Megabyte','MB',1e6], ['Mebibyte','MiB',2**20], ['Bit','bit',1/8], ['Byte','B',1],
        ['Kilobyte','kB',1000], ['Kibibyte','KiB',2**10], ['Gigabyte','GB',1e9], ['Gibibyte','GiB',2**30],
        ['Terabyte','TB',1e12], ['Tebibyte','TiB',2**40]
      ]],
      ['transfer','Data transfer',[
        ['Megabit per second','Mbit/s',1e6/8], ['Megabyte per second','MB/s',1e6],
        ['Kilobit per second','kbit/s',1000/8], ['Kilobyte per second','kB/s',1000],
        ['Gigabit per second','Gbit/s',1e9/8], ['Mebibyte per second','MiB/s',2**20]
      ]]
    ]],
    ['Energy and temperature', [
      ['energy','Energy',[
        ['Joule','J',1], ['Kilowatt-hour','kWh',3.6e6], ['Kilojoule','kJ',1000], ['Watt-hour','Wh',3600],
        ['Calorie (thermochemical)','cal',4.184], ['Kilocalorie','kcal',4184],
        ['British thermal unit (IT)','Btu',1055.05585262], ['Kilogram of TNT','kg TNT',4.184e6],
        ['Electronvolt','eV',1.602176634e-19]
      ]],
      ['power','Power',[
        ['Kilowatt','kW',1000], ['Mechanical horsepower','hp',550*footPound], ['Watt','W',1],
        ['Megawatt','MW',1e6], ['Metric horsepower','PS',75*gravity]
      ]],
      ['temperature','Temperature',[
        ['Celsius','°C',1,273.15], ['Fahrenheit','°F',5/9,273.15-32*5/9], ['Kelvin','K',1]
      ]]
    ]],
    ['Electricity', [
      ['charge','Electric charge',[
        ['Coulomb','C',1], ['Ampere-hour','A·h',3600], ['Milliampere-hour','mA·h',3.6], ['Elementary charge','e',1.602176634e-19]
      ]],
      ['current','Electric current',[['Ampere','A',1], ['Milliampere','mA',0.001], ['Microampere','µA',1e-6]]],
      ['resistance','Electrical resistance',[['Ohm','Ω',1], ['Kilohm','kΩ',1000], ['Megohm','MΩ',1e6]]],
      ['potential','Electric potential',[['Volt','V',1], ['Millivolt','mV',0.001], ['Kilovolt','kV',1000]]],
      ['capacitance','Electric capacitance',[
        ['Farad','F',1], ['Microfarad','µF',1e-6], ['Millifarad','mF',0.001], ['Nanofarad','nF',1e-9], ['Picofarad','pF',1e-12]
      ]]
    ]],
    ['Photometry', [
      ['luminance','Luminance',[
        ['Candela per square metre (nit)','cd/m²',1], ['Lambert','L',10000/Math.PI], ['Stilb','sb',10000]
      ]],
      ['illuminance','Illuminance',[['Lux','lx',1], ['Foot-candle','fc',1/foot**2], ['Phot','ph',10000]]]
    ]],
    ['Radioactivity', [
      ['absorbed-dose','Absorbed radiation dose',[['Gray','Gy',1], ['Rad','rad',0.01], ['Milligray','mGy',0.001]]],
      ['equivalent-dose','Equivalent radiation dose',[['Sievert','Sv',1], ['Rem','rem',0.01], ['Millisievert','mSv',0.001], ['Microsievert','µSv',1e-6]]],
      ['activity','Radioactive activity',[['Becquerel','Bq',1], ['Curie','Ci',3.7e10], ['Kilobecquerel','kBq',1000], ['Megabecquerel','MBq',1e6], ['Rutherford','Rd',1e6]]]
    ]],
    ['Magnetism', [
      ['magnetism','Magnetic flux density',[['Tesla','T',1], ['Gauss','G',1e-4], ['Microtesla','µT',1e-6], ['Gamma','γ',1e-9]]]
    ]],
    ['Mathematics and astronomy', [
      ['angle','Angle',[
        ['Degree','°',degree], ['Radian','rad',1], ['Arcminute','′',degree/60], ['Arcsecond','″',degree/3600],
        ['Turn','turn',2*Math.PI], ['Gradian','gon',Math.PI/200]
      ]],
      ['count','Units and fractions',[['Unit','unit',1], ['Dozen','doz',12], ['Pair','pair',2], ['Half','half',0.5], ['Gross','gross',144]]],
      ['prefix','SI prefix multipliers',[
        ['Kilo','k',1000], ['Base unit','1',1], ['Tera','T',1e12], ['Giga','G',1e9], ['Mega','M',1e6],
        ['Deci','d',0.1], ['Centi','c',0.01], ['Milli','m',1e-3], ['Micro','µ',1e-6], ['Nano','n',1e-9], ['Pico','p',1e-12]
      ]],
      ['astronomy','Astronomical distance',[
        ['Astronomical unit','au',au], ['Kilometre','km',1000], ['Light-year','ly',299792458*31557600],
        ['Parsec','pc',au*648000/Math.PI]
      ]]
    ]],
    ['Other', [
      ['typography','Typography',[['Point (PostScript)','pt',0.0254/72], ['Pica','pc',0.0254/6], ['Millimetre','mm',0.001], ['Inch','in',0.0254]]]
    ]]
  ];

  const categories = new Map(groups.flatMap(([,entries]) => entries.map(entry => [entry[0],entry])));
  const numericFormat = new Intl.NumberFormat('en-CA',{maximumSignificantDigits:12});
  const scientificFormat = new Intl.NumberFormat('en-CA',{notation:'scientific',maximumSignificantDigits:12});

  function parseAmount(text) {
    const value = text.trim().replace('−','-').replace(',','.');
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
  }

  function convert(category,value,from,to,rates) {
    const units = categories.get(category)?.[2];
    if (!units || !Number.isFinite(value)) return NaN;
    const source = units.find(unit => unit[1] === from), target = units.find(unit => unit[1] === to);
    if (!source || !target) return NaN;
    if (category === 'currency') return from === to ? value : value*(rates?.[to]/rates?.[from]);
    const [, , sourceFactor, sourceOffset = 0] = source;
    const [, , targetFactor, targetOffset = 0] = target;
    if (category === 'fuel' && (value < 0 || (value === 0 && (sourceOffset === 'reciprocal' || targetOffset === 'reciprocal')))) return NaN;
    let base = sourceOffset === 'reciprocal' ? sourceFactor/value : value*sourceFactor+sourceOffset;
    if (category === 'temperature') {
      if (base < -1e-10) return NaN;
      if (Math.abs(base) < 1e-10) base = 0;
    }
    return targetOffset === 'reciprocal' ? targetFactor/base : (base-targetOffset)/targetFactor;
  }

  function referenceRates(data) {
    if (data?.base !== 'CAD' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return null;
    const rates = {CAD:1};
    for (const [,code] of currencies.slice(1)) {
      const rate = data.rates?.[code];
      if (!Number.isFinite(rate) || rate <= 0) return null;
      rates[code] = rate;
    }
    return {base:'CAD',date:data.date,rates};
  }

  const searchAliases = {length:'distance',fuel:'fuel economy mileage',speed:'velocity',storage:'decimal binary 1000 1024'};
  const normalise = value => value.toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu,'')
    .replace(/metre/g,'meter').replace(/litre/g,'liter').replace(/μ/g,'u')
    .replace(/\bfeet\b/g,'foot').replace(/\binches\b/g,'inch');
  function searchCategories(query) {
    const words = normalise(query).trim().split(/\s+/).filter(Boolean);
    return groups.map(([group,entries]) => [group,entries.filter(([id,name,units]) => {
      const index = normalise([group,name,searchAliases[id] || '',...units.flatMap(unit => unit.slice(0,2))].join(' '));
      return words.every(word => index.includes(word));
    })]).filter(([,entries]) => entries.length);
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {convert,parseAmount,referenceRates,searchCategories};
    return;
  }

  const $ = id => document.getElementById(id);
  const dialog = $('scientificMenu'), settings = $('scientificMenuSettings'), panel = $('unitConverter');
  const launch = $('openUnitConverter'), back = $('backFromUnitConverter');
  const browser = $('unitCategoryBrowse'), search = $('unitCategorySearch'), list = $('unitCategories');
  const detail = $('unitConverterDetail'), heading = $('unitCategoryTitle');
  const amount = $('unitAmount'), from = $('unitFrom'), to = $('unitTo'), output = $('unitResult');
  const rateActions = $('unitRateActions'), rateButton = $('unitRefreshRates'), status = $('unitConversionStatus');
  const rateKey = 'gregle-calc-reference-rates';
  const endpoint = 'https://api.frankfurter.dev/v1/latest?base=CAD&symbols='+currencies.slice(1).map(([,code]) => code).join(',');
  let selected = '', rates = null, loading = false, ratesFailed = false;
  try {rates = referenceRates(JSON.parse(localStorage.getItem(rateKey)));} catch (_) {}

  function element(tag,className,label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  }

  function renderCategories() {
    const items = document.createDocumentFragment();
    const matching = searchCategories(search.value);
    for (const [group,entries] of matching) {
      const section = element('section','unit-category-group');
      section.append(element('h3','',group));
      for (const [id,name,units] of entries) {
        const button = element('button','unit-category-link');
        button.type = 'button';
        button.dataset.unitCategory = id;
        const label = element('span','');
        label.append(element('strong','',name),element('small','',units.slice(0,3).map(unit => unit[1]).join(' · ')));
        const arrow = element('span','unit-category-arrow','›');
        arrow.setAttribute('aria-hidden','true');
        button.append(label,arrow);
        section.append(button);
      }
      items.append(section);
    }
    if (!matching.length) items.append(element('p','', 'No matching units or categories.'));
    list.replaceChildren(items);
  }

  function updateResult() {
    if (!selected) return;
    const value = parseAmount(amount.value);
    const result = convert(selected,value,from.value,to.value,rates?.rates);
    const format = Math.abs(result) >= 1e12 || (result !== 0 && Math.abs(result) < 1e-6) ? scientificFormat : numericFormat;
    output.textContent = Number.isFinite(result) ? format.format(result)+' '+to.value : '—';
    const finiteInput = Number.isFinite(value);
    if (selected === 'currency') {
      rateButton.disabled = loading || !navigator.onLine;
      if (rates) {
        const cached = !navigator.onLine || ratesFailed;
        status.textContent = (cached ? 'Last downloaded rates' : 'Reference rates')+' · '+rates.date+' · Frankfurter';
      } else if (loading) status.textContent = 'Downloading reference rates…';
      else status.textContent = navigator.onLine ? 'Rates unavailable. Try Refresh rates.' : 'Connect to the internet to download rates.';
    } else if (finiteInput && !Number.isFinite(result)) {
      if (selected === 'temperature') status.textContent = 'Temperatures must be at or above absolute zero.';
      else if (selected === 'fuel') status.textContent = 'Enter a positive amount for this conversion.';
      else status.textContent = 'The result is outside the supported range.';
    } else status.textContent = '';
  }

  async function refreshRates() {
    if (loading || !navigator.onLine) return;
    loading = true;
    ratesFailed = false;
    updateResult();
    try {
      const response = await fetch(endpoint,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('Exchange rates unavailable');
      const fresh = referenceRates(await response.json());
      if (!fresh) throw Error('Incomplete exchange-rate table');
      rates = fresh;
      try {localStorage.setItem(rateKey,JSON.stringify(rates));} catch (_) {}
    } catch (_) {ratesFailed = true;}
    finally {loading = false; updateResult();}
  }

  function selectCategory(id) {
    const category = categories.get(id);
    if (!category) return;
    selected = id;
    browser.hidden = true;
    detail.hidden = false;
    heading.textContent = category[1];
    for (const picker of [from,to]) {
      const options = category[2].map(([name,symbol]) => {
        const option = element('option','',name+' ('+symbol+')');
        option.value = symbol;
        return option;
      });
      picker.replaceChildren(...options);
    }
    to.selectedIndex = 1;
    rateActions.hidden = id !== 'currency';
    dialog.scrollTop = 0;
    heading.focus({preventScroll:true});
    updateResult();
    if (id === 'currency') void refreshRates();
  }

  function openConverter(open) {
    settings.hidden = open;
    panel.hidden = !open;
    dialog.classList.toggle('converter-open',open);
    dialog.scrollTop = 0;
  }

  launch.addEventListener('click',() => {
    selected = '';
    browser.hidden = false;
    detail.hidden = true;
    renderCategories();
    openConverter(true);
    back.focus({preventScroll:true});
  });
  back.addEventListener('click',() => {
    if (selected) {
      const previous = selected;
      selected = '';
      detail.hidden = true;
      browser.hidden = false;
      list.querySelector('[data-unit-category="'+previous+'"]')?.focus();
    } else {
      openConverter(false);
      launch.focus({preventScroll:true});
    }
  });
  dialog.addEventListener('close',() => {if (!panel.hidden) openConverter(false);});
  list.addEventListener('click',event => selectCategory(event.target.closest('[data-unit-category]')?.dataset.unitCategory));
  search.addEventListener('input',renderCategories);
  amount.addEventListener('input',updateResult);
  for (const input of [search,amount]) input.addEventListener('keydown',event => {if (event.key === 'Enter') event.preventDefault();});
  for (const picker of [from,to]) picker.addEventListener('change',updateResult);
  $('unitSwap').addEventListener('click',() => {
    const previous = from.value;
    from.value = to.value;
    to.value = previous;
    updateResult();
  });
  $('unitSign').addEventListener('click',() => {
    amount.value = /^[-−]/.test(amount.value.trim()) ? amount.value.trim().slice(1) : '-'+amount.value.trim();
    updateResult();
  });
  rateButton.addEventListener('click',refreshRates);
  window.addEventListener('online',() => {if (dialog.open && !panel.hidden && selected === 'currency') void refreshRates();});
  window.addEventListener('offline',updateResult);
})();
