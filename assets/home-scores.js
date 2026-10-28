(() => {
  'use strict';
  const S = window.GregleSports;
  const scores = document.getElementById('homeScores');
  const desktop = window.matchMedia('(min-width: 801px)');
  if (!S || !scores) return;
  const ids = S.teams.map(team => team.id);
  const schedules = new Map(), details = new Map(), stopped = new Set(), pending = new Set(), controllers = new Set();
  let loading = false, generation = 0, lastSchedule = null, rendered = '';
  const enabled = () => desktop.matches && !document.hidden;
  const fresh = entry => entry && Date.now() - entry.at < 90000;
  const live = match => match.live && !match.completed && !match.special;
  function matches() {
    const events = S.combineEvents([...schedules.values()].filter(fresh).map(entry => entry.events));
    return S.selectEvents(events, ids, 'live').flatMap(match => {
      const detail = details.get(match.id);
      if (stopped.has(match.id) || !live(match)) return [];
      // A summary is newer than its schedule and can end a game immediately.
      return fresh(detail) ? live(detail.event) ? [detail.event] : [] : [match];
    });
  }
  function fit() {
    if (!enabled() || !scores.children.length) return;
    const chips = [...scores.children];
    chips.forEach(chip => { chip.hidden = false; });
    const gap = parseFloat(getComputedStyle(scores).columnGap) || 0;
    const total = chips.reduce((width, chip) => width + chip.getBoundingClientRect().width, 0) + gap * (chips.length - 1);
    if (total > scores.clientWidth) chips.forEach((chip, index) => { chip.hidden = index > 0; });
  }
  function render() {
    const active = enabled() ? matches() : [];
    const html = active.map(match => {
      const followed = S.teams.find(team => team.id === match.home.id || team.id === match.away.id);
      const gender = followed?.group.startsWith('women') ? 'Women' : 'Men';
      const short = team => (S.teams.find(known => known.id === team.id)?.abbreviation || team.abbreviation || team.name.slice(0, 3)).slice(0, 5);
      const label = gender + ': ' + match.home.name + ' ' + match.home.score + ', ' + match.away.name + ' ' + match.away.score + '. Live, ' + match.detail + '. Open Sports';
      const E = S.escape;
      return '<a class="score-chip" href="https://sports.gregle.uk/" aria-label="' + E(label) + '" title="' + E(label) + '"><span>' + E(short(match.home)) + '</span><strong>' + E(match.home.score) + '–' + E(match.away.score) + '</strong><span>' + E(short(match.away)) + (gender === 'Women' ? ' · W' : '') + '</span><span class="score-chip-status">LIVE · ' + E(String(match.detail).slice(0, 14)) + '</span></a>';
    }).join('');
    if (html !== rendered) { scores.innerHTML = html; rendered = html; }
    scores.hidden = !active.length;
    fit();
  }
  async function request(url) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Score feed unavailable');
      return await response.json();
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function loadDetail(match, round) {
    if (pending.has(match.id) || !/^\d+$/.test(match.id)) return;
    pending.add(match.id);
    try {
      const slug = /^[a-z0-9.]+$/.test(match.leagueSlug || '') ? match.leagueSlug : 'all';
      const payload = await request('https://site.api.espn.com/apis/site/v2/sports/soccer/' + slug + '/summary?event=' + match.id);
      const event = S.event({ ...payload.header, league: payload.header?.leagues?.[0] });
      if (!event || event.id !== match.id || event.home.id !== match.home.id || event.away.id !== match.away.id) throw new Error('Wrong match');
      if (round !== generation || !enabled()) return;
      details.set(match.id, { event, at: Date.now() });
      if (event.completed || event.state === 'post') stopped.add(match.id);
    } catch (_) { /* Only recent successful responses remain eligible for display. */ }
    finally { pending.delete(match.id); render(); }
  }
  async function refresh() {
    render();
    if (!enabled() || loading) return;
    const round = generation;
    const detailJobs = matches().map(match => loadDetail(match, round));
    if (lastSchedule !== null && Date.now() - lastSchedule < 60000) { await Promise.all(detailJobs); return; }
    loading = true; lastSchedule = Date.now();
    // Both schedule views are needed: providers can move an in-progress game to results.
    const jobs = S.teams.flatMap(team => ['true', 'false'].map(fixture => ({ team, fixture })));
    let index = 0;
    try {
      await Promise.all([...detailJobs, ...Array.from({ length: 6 }, async () => {
        while (index < jobs.length && enabled() && round === generation) {
          const { team, fixture } = jobs[index++];
          try {
            const payload = await request('https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/' + team.id + '/schedule?fixture=' + fixture);
            if (!Array.isArray(payload.events) || String(payload.team?.id) !== team.id) throw new Error('Wrong team schedule');
            if (round !== generation || !enabled()) return;
            schedules.set(team.id + ':' + fixture, { events: payload.events, at: Date.now() });
            for (const event of S.combineEvents([payload.events])) if (event.completed || event.state === 'post') stopped.add(event.id);
          } catch (_) { /* Expire failed feeds instead of labelling old scores live. */ }
        }
      })]);
    } finally { loading = false; render(); }
    if (enabled()) await Promise.all(matches().map(match => loadDetail(match, generation)));
  }
  function suspend() {
    generation++;
    controllers.forEach(controller => controller.abort());
    schedules.clear(); details.clear(); lastSchedule = null;
    scores.hidden = true;
  }
  function visibility() {
    if (!enabled()) suspend();
    else void refresh();
  }
  desktop.addEventListener?.('change', visibility);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', visibility);
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(scores.parentElement);
  document.fonts?.ready.then(fit);
  setInterval(() => { void refresh(); }, 30000);
  void refresh();
})();
