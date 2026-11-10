(function (root) {
  'use strict';
  const MAX_AGE = 48 * 60 * 60 * 1000;
  function usable(data, now = Date.now()) {
    if (!data || !Array.isArray(data.items)) return [];
    const age = now - Date.parse(data.fetchedAt || data.feedUpdatedAt);
    if (!Number.isFinite(age) || age < -300000 || age > MAX_AGE) return [];
    const seen = new Set();
    return data.items.filter(item => {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) return false;
      try {
        const url = new URL(item.link);
        if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)bbc\.(co\.uk|com)$/.test(url.hostname) || seen.has(url.href)) return false;
        seen.add(url.href); return true;
      } catch (_) { return false; }
    }).slice(0, 10);
  }
  function fromRSS(raw, Parser = root.DOMParser) {
    if (typeof raw !== 'string' || raw.length > 500000 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('Invalid feed');
    const xml = new Parser().parseFromString(raw, 'application/xml');
    if (xml.querySelector('parsererror')) throw Error('Invalid RSS');
    const channel = xml.querySelector('rss > channel');
    if (!channel) throw Error('Missing RSS channel');
    return {
      feedUpdatedAt: channel.querySelector('lastBuildDate')?.textContent,
      items: Array.from(channel.querySelectorAll('item')).slice(0, 100).map(item => ({
        title: item.querySelector('title')?.textContent.trim() || '',
        link: item.querySelector('link')?.textContent.trim() || '',
      })),
    };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { usable, fromRSS }; return; }
  const $ = id => document.getElementById(id);
  const track = $('sport-news-track'), viewport = $('sport-news-window');
  if (!track || !viewport) return;
  const ticker = viewport.closest('.sport-ticker'), reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let saved = null, loading = false, hover = false, focus = false, frame = null, last = 0, offset = 0, signature = '';
  function motion() {
    if (frame) cancelAnimationFrame(frame);
    frame = null; last = 0;
    const still = reduced.matches || focus || (track.firstElementChild?.scrollWidth || 0) <= viewport.clientWidth;
    ticker.classList.toggle('is-static', still);
    if (still) { offset = 0; track.style.transform = 'translateX(0px)'; return; }
    if (hover || document.hidden) return;
    function step(time) {
      const width = track.firstElementChild?.scrollWidth || 0;
      if (last && width) offset = (offset - Math.min(time - last, 100) * 0.12) % width;
      last = time;
      track.style.transform = 'translateX(' + offset + 'px)';
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
  }
  function render(items) {
    const next = JSON.stringify(items);
    if (signature === next || focus) return;
    signature = next;
    const markup = items.map(item => '<a href="' + escape(item.link) + '" target="_blank" rel="noopener noreferrer">' + escape(item.title) + '</a>').join('');
    track.innerHTML = '<div class="sport-ticker-group">' + markup + '</div><div class="sport-ticker-group ticker-copy" aria-hidden="true" inert>' + markup.replace(/<a /g, '<a tabindex="-1" ') + '</div>';
    offset = 0; viewport.scrollLeft = 0; motion();
  }
  async function read(url, rss = false) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw Error('Headlines unavailable');
      const data = rss ? fromRSS(await response.text()) : await response.json();
      if (!usable(data).length) throw Error('No fresh headlines');
      return data;
    } finally { clearTimeout(timer); }
  }
  async function load() {
    if (loading) return;
    loading = true;
    try {
      let data;
      try { data = await read('/api/sports/headlines', true); }
      catch (_) { data = await read('data/bbc-sport.json'); }
      // A delayed static build must not replace newer headlines already loaded.
      if (usable(saved).length && Date.parse(saved.fetchedAt || saved.feedUpdatedAt) > Date.parse(data.fetchedAt || data.feedUpdatedAt)) data = saved;
      const items = usable(data);
      saved = data; render(items);
      $('sport-news-status').textContent = 'BBC Sport headlines updated.';
    } catch (_) {
      const previous = usable(saved);
      render(previous.length ? previous : [{ title: 'Headlines unavailable · Read the latest on BBC Sport ↗', link: 'https://www.bbc.com/sport' }]);
      $('sport-news-status').textContent = previous.length ? 'BBC Sport refresh unavailable; recent headlines retained.' : 'BBC Sport headlines unavailable. Use the BBC Sport link.';
    } finally { loading = false; }
  }
  viewport.addEventListener('mouseenter', () => { hover = true; motion(); });
  viewport.addEventListener('mouseleave', () => { hover = false; motion(); });
  viewport.addEventListener('focusin', () => { focus = true; motion(); });
  viewport.addEventListener('focusout', event => { if (!viewport.contains(event.relatedTarget)) { focus = false; viewport.scrollLeft = 0; motion(); } });
  reduced.addEventListener('change', motion);
  root.addEventListener('resize', motion);
  document.addEventListener('visibilitychange', () => { motion(); if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 5 * 60000);
  load();
})(globalThis);
