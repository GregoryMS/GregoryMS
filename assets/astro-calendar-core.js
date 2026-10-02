(function (root) {
  'use strict';
  const DAY = 86400000;
  const moonSource = 'https://aa.usno.navy.mil/data/MoonPhases';
  const seasonSource = 'https://aa.usno.navy.mil/data/Earth_Seasons';
  const moonNotes = {
    'New Moon': 'The Moon is near the Sun in the sky and its sunlit side faces away from Earth. The surrounding nights are useful for faint galaxies and nebulae, once twilight ends.',
    'First Quarter': 'Half of the lunar disc is illuminated. Look in the afternoon or evening; shadows along the light–dark boundary reveal craters and mountains through binoculars or a telescope.',
    'Full Moon': 'The lunar disc is fully illuminated. It rises around sunset and is prominent through the night. Moonlight reduces contrast for faint deep-sky objects.',
    'Last Quarter': 'Half of the lunar disc is illuminated. Look late at night or in the morning. The evening hours before moonrise can offer darker skies.'
  };
  function instant(row) {
    if (!Number.isInteger(row.year) || !Number.isInteger(row.month) || !Number.isInteger(row.day) || !/^\d{2}:\d{2}$/.test(row.time)) throw Error('Invalid event date');
    const [h, m] = row.time.split(':').map(Number);
    const date = new Date(Date.UTC(row.year, row.month - 1, row.day, h, m));
    if (h > 23 || m > 59 || date.getUTCFullYear() !== row.year || date.getUTCMonth() !== row.month - 1 || date.getUTCDate() !== row.day) throw Error('Invalid event date');
    return date.toISOString();
  }
  function parseYear(moon, seasons, year) {
    if (moon?.error || seasons?.error || !Array.isArray(moon?.phasedata) || !Array.isArray(seasons?.data) || moon.phasedata.length < 48 || seasons.data.length < 4) throw Error('Incomplete event dates');
    const events = moon.phasedata.map(row => {
      if (!moonNotes[row.phase] || row.year !== year) throw Error('Invalid Moon phase');
      const start = instant(row);
      return {id:'moon-' + start.slice(0,10) + '-' + row.phase.toLowerCase().replaceAll(' ', '-'), title:row.phase, kind:'Moon', start, description:moonNotes[row.phase], source:moonSource, sourceName:'US Naval Observatory', timing:'Time of the phase, not moonrise. Visibility depends on your horizon and weather.'};
    });
    for (const row of seasons.data) {
      if (!['Equinox', 'Solstice'].includes(row.phenom)) continue;
      if (row.year !== year) throw Error('Invalid season');
      const start = instant(row), month = new Date(start).toLocaleString('en', {month:'long', timeZone:'UTC'});
      const description = row.phenom === 'Equinox' ? 'The Sun crosses Earth’s equator. This marks the start of astronomical spring in one hemisphere and autumn in the other; day and night are roughly equal in length.' : 'The Sun reaches its northernmost or southernmost position in our sky. This marks the start of astronomical summer in one hemisphere and winter in the other.';
      events.push({id:'season-' + start.slice(0,10), title:month + ' ' + row.phenom.toLowerCase(), kind:'Season', start, description, source:seasonSource, sourceName:'US Naval Observatory', timing:'A worldwide astronomical instant. This is not a separate visible flash or sky display.'});
    }
    if (events.filter(e => e.kind === 'Season').length !== 4) throw Error('Incomplete seasons');
    return events;
  }
  function meteorEvents(year) {
    // Typical annual peak nights, deliberately labelled approximate, not a year-specific forecast.
    const showers = [
      ['Quadrantids',1,3,'Best suited to northern latitudes; the peak can be brief.'],
      ['Lyrids',4,22,'A northern spring shower.'],
      ['Eta Aquariids',5,5,'Favours southern and tropical latitudes; fewer meteors are visible far north.'],
      ['Southern Delta Aquariids',7,30,'Favours the Southern Hemisphere and southern northern latitudes.'],
      ['Perseids',8,12,'A well-known Northern Hemisphere summer shower.'],
      ['Orionids',10,21,'A shower produced by debris from Halley’s Comet.'],
      ['Southern Taurids',11,4,'A slow shower known for occasional bright fireballs.'],
      ['Northern Taurids',11,11,'A modest shower that can produce bright meteors.'],
      ['Leonids',11,17,'A November shower; a meteor storm is not expected every year.'],
      ['Geminids',12,13,'A strong annual shower, with activity visible before midnight as well as later.'],
      ['Ursids',12,21,'A modest December shower best placed for northern observers.']
    ];
    return showers.map(([name, month, day, note]) => {
      // Year-specific peak nights checked against the AMS 2026/2027 calendar.
      if (year === 2026 && name === 'Leonids') day = 16;
      if (year === 2027 && name === 'Lyrids') day = 21;
      const start = new Date(Date.UTC(year, month-1, day)).toISOString().slice(0,10);
      return {id:'meteor-' + year + '-' + name.toLowerCase().replaceAll(' ','-'), title:name + ' peak (approx.)', kind:'Meteors', start, end:new Date(Date.UTC(year,month-1,day+2)).toISOString().slice(0,10), allDay:true, description:note + ' Find a dark, open sky, allow your eyes to adapt, and watch with the naked eye. Moonlight, clouds and the height of the radiant affect what you can see.', timing:'Typical peak night around ' + month + '/' + day + '–' + (day+1) + '. The exact peak shifts each year; check the source for that year’s forecast. Saved as a two-day, all-day reminder, not an exact observing appointment.', source:'https://www.amsmeteors.org/calendar/', sourceName:'American Meteor Society calendar'};
    });
  }
  function dateKey(value, zone) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const part = type => parts.find(p => p.type === type).value;
    return part('year') + '-' + part('month') + '-' + part('day');
  }
  function eventDate(event, zone) { return event.allDay ? event.start : dateKey(event.start, zone); }
  function escapeText(value) { return String(value).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
  function stamp(value) { return new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'); }
  function description(event) { return event.description + '\n\n' + event.timing + '\n\nSource: ' + event.source; }
  function foldLine(line) {
    // RFC 5545: fold at 75 UTF-8 octets without splitting a code point.
    let result = '', length = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (length + bytes > 75) { result += '\r\n '; length = 1; }
      result += char; length += bytes;
    }
    return result;
  }
  function ical(events, now = new Date()) {
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Gregle//Astronomy Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
    for (const event of events) {
      lines.push('BEGIN:VEVENT','UID:' + event.id + '@gregle.uk','DTSTAMP:' + stamp(now));
      if (event.allDay) lines.push('DTSTART;VALUE=DATE:' + event.start.replaceAll('-',''),'DTEND;VALUE=DATE:' + event.end.replaceAll('-',''));
      else lines.push('DTSTART:' + stamp(event.start),'DTEND:' + stamp(new Date(new Date(event.start).getTime() + 60000)));
      lines.push('SUMMARY:' + escapeText(event.title),'DESCRIPTION:' + escapeText(description(event)),'URL:' + event.source,'TRANSP:TRANSPARENT','END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  function googleURL(event) {
    const dates = event.allDay ? event.start.replaceAll('-','') + '/' + event.end.replaceAll('-','') : stamp(event.start) + '/' + stamp(new Date(new Date(event.start).getTime()+60000));
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({action:'TEMPLATE',text:event.title,dates,details:description(event)});
  }
  const api = {DAY,parseYear,meteorEvents,dateKey,eventDate,ical,googleURL};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GregleAstroEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
