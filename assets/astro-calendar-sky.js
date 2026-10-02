(function (root) {
  'use strict';
  const DAY = 86400000;
  const engineSource = 'https://github.com/cosinekitty/astronomy';
  const cap = value => value[0].toUpperCase() + value.slice(1);
  function skyEvents(year, A) {
    if (!A || !Number.isInteger(year) || year < 1700 || year > 2100) throw Error('Sky calculations unavailable');
    const start = new Date(Date.UTC(year,0,1)), end = new Date(Date.UTC(year+1,0,1)), events = [];
    function add(type, body, time, title, description, timing, source = engineSource, sourceName = 'Astronomy Engine calculations') {
      const date = time.date.toISOString();
      events.push({id:type+'-'+body.toLowerCase()+'-'+date.slice(0,10),title,kind:type === 'eclipse' ? 'Eclipse' : 'Planets',start:date,description,timing,source,sourceName});
    }
    const planetNotes = {
      Mars:'A telescope can show its small disc and, when conditions allow, surface markings.',
      Jupiter:'Binoculars can reveal its four largest moons; a telescope shows the cloud bands.',
      Saturn:'A telescope reveals its rings; their apparent tilt changes over the years.',
      Uranus:'Use binoculars or a telescope and a current finder chart to identify this faint planet.',
      Neptune:'A telescope and a finder chart are needed; it remains a very small disc.'
    };
    for (const body of Object.keys(planetNotes)) {
      let time = A.SearchRelativeLongitude(body,0,start);
      while (time.date < end) {
        add('opposition',body,time,body+' at opposition',body+' lies opposite the Sun in the sky. The surrounding nights are a favourable viewing window, with the planet generally rising near sunset and highest around the middle of the night. '+planetNotes[body], 'Calculated opposition instant. You can observe on nearby nights; the exact instant is not a required viewing time. Your latitude, horizon and weather determine visibility. Opposition and closest approach need not occur at exactly the same time.');
        time = A.SearchRelativeLongitude(body,0,time.AddDays(1));
      }
    }
    for (const body of ['Mercury','Venus']) {
      let event = A.SearchMaxElongation(body,start);
      while (event.time.date < end) {
        const evening = event.visibility === 'evening';
        add('elongation',body,event.time,body+' at greatest '+(evening?'eastern':'western')+' elongation',body+' reaches a wide angular separation from the Sun ('+event.elongation.toFixed(1)+'°). Look '+(evening?'toward the west after sunset':'toward the east before sunrise')+'. This is a useful period to look for the planet, although its height above your horizon depends on latitude and season.', 'Calculated maximum separation from the Sun. Plan around local '+(evening?'sunset':'sunrise')+' on nearby days, rather than the event clock time. Observe only while the Sun is below the horizon, and never point binoculars or a telescope toward the Sun.');
        event = A.SearchMaxElongation(body,event.time.AddDays(1));
      }
    }
    for (const solar of [true,false]) {
      let event = solar ? A.SearchGlobalSolarEclipse(start) : A.SearchLunarEclipse(start);
      while (event.peak.date < end) {
        const type = event.kind;
        const description = solar
          ? 'The Moon passes in front of the Sun. '+({total:'At greatest eclipse, the Sun is completely covered along a narrow path.',annular:'Along the central path, a ring of sunlight remains around the Moon.',partial:'The Moon covers part of the Sun in the regions reached by its shadow.'}[type])+' The eclipse is not visible everywhere. Use the eclipse maps to check the path and local circumstances. Use proper solar viewing protection while any bright part of the Sun is visible. Never look through unfiltered binoculars or a telescope at the Sun.'
          : ({total:'The Moon passes fully into Earth’s dark central shadow and may turn copper-red.',partial:'Part of the Moon enters Earth’s dark central shadow, giving it a darkened edge.',penumbral:'The Moon passes through Earth’s faint outer shadow. The dimming may be subtle or imperceptible.'}[type])+' It can be seen only where the Moon is above the horizon during the eclipse. Lunar eclipses are safe to view with the naked eye.';
        const timing = solar ? 'Calculated worldwide maximum, not your local maximum or the eclipse start. Type describes the eclipse at its greatest point; a hybrid eclipse can change type along its path. Check the source maps for local visibility and contact times.' : 'Calculated time of greatest eclipse, not its start. The eclipse unfolds before and after this time. Check the source maps for the full sequence and local visibility.';
        const source = year === 2026 || year === 2027 ? 'https://eclipse.gsfc.nasa.gov/OH/OH'+year+'.html' : 'https://eclipse.gsfc.nasa.gov/';
        add('eclipse',solar?'solar':'lunar',event.peak,solar?'Solar eclipse ('+type+' at peak)':cap(type)+' lunar eclipse',description,timing,source,'NASA eclipse maps and details');
        event = solar ? A.NextGlobalSolarEclipse(event.peak) : A.NextLunarEclipse(event.peak);
      }
    }
    return events.sort((a,b)=>a.start.localeCompare(b.start));
  }
  function decorateMoons(events, zone, A, dateKey) {
    const fullMoons = events.filter(e=>e.kind==='Moon' && e.title==='Full Moon').sort((a,b)=>a.start.localeCompare(b.start));
    const seenMonths = new Set(), decorated = new Map();
    for (const event of fullMoons) {
      const month = dateKey(event.start,zone).slice(0,7), labels = [], notes = [];
      if (seenMonths.has(month)) {
        labels.push('Blue Moon');
        notes.push('This is the second full moon in this calendar month in '+zone+' (the monthly definition of a blue moon). The name does not mean the Moon will look blue.');
      }
      seenMonths.add(month);
      if (A) {
        const distance = A.GeoMoon(new Date(event.start)).Length()*A.KM_PER_AU;
        if (distance <= 365000) {
          labels.push('Supermoon');
          notes.push('The Moon is about '+Math.round(distance/100)*100+' km from Earth’s centre. This calendar calls full moons within 365,000 km supermoons; the informal term has no single official distance threshold. It may appear a little larger than an average full moon.');
        }
      }
      if (labels.length) decorated.set(event.id,{...event,title:event.title+' · '+labels.join(' · '),description:event.description+'\n\n'+notes.join('\n\n')});
    }
    return events.map(event=>decorated.get(event.id)||event);
  }
  const api = {skyEvents,decorateMoons};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GregleAstroSky = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
