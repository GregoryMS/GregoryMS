(function (root) {
  'use strict';
  const FEED = 'https://www.universetoday.com/feed';
  const SITE = 'https://www.universetoday.com/';
  const MAX_AGE = 6 * 60 * 60 * 1000;

  function usable(data, now = Date.now()) {
    if (!data || !Array.isArray(data.items)) return [];
    const age = now - Date.parse(data.feedUpdatedAt);
    if (!Number.isFinite(age) || age < -300000 || age > MAX_AGE) return [];
    const seen = new Set();
    return data.items.filter(item => {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) return false;
      try {
        const url = new URL(item.link);
        if (url.protocol !== 'https:' || url.username || url.password ||
            !/(^|\.)universetoday\.com$/.test(url.hostname) || seen.has(url.href)) return false;
        seen.add(url.href);
        return true;
      } catch (_) { return false; }
    }).slice(0, 10);
  }

  function readSnapshot(data) {
    const feed = data?.feeds?.find(item => item.url === FEED);
    if (!feed || typeof feed.xml !== 'string' || feed.xml.length > 500000 || /<!DOCTYPE|<!ENTITY/i.test(feed.xml)) return null;
    const xml = new DOMParser().parseFromString(feed.xml, 'application/xml');
    if (xml.querySelector('parsererror') || !xml.querySelector('rss > channel')) return null;
    return { feedUpdatedAt: feed.fetchedAt, items: Array.from(xml.querySelectorAll('channel > item'), item => ({
      title: item.querySelector('title')?.textContent || '',
      link: item.querySelector('link')?.textContent || ''
    })) };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { usable, FEED }; return; }
  const $ = id => document.getElementById(id);
  const track = $('astro-news-track'), viewport = $('astro-news-viewport');
  if (!track || !viewport) return;
  const ticker = $('astro-news'), status = $('astro-news-status');
  const reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let saved = null, pending = null, loading = false, hover = false, focus = false;
  let frame = null, last = 0, offset = 0, signature = '';

  function motion() {
    if (frame !== null) cancelAnimationFrame(frame);
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
    pending = items;
    const next = JSON.stringify(items);
    if (signature === next || focus) return;
    signature = next;
    const markup = items.map(item => '<a href="' + escape(item.link) + '" target="_blank" rel="noopener noreferrer">' + escape(item.title) + '</a><span class="astro-news-sep" aria-hidden="true">•</span>').join('');
    track.innerHTML = '<div class="astro-news-group">' + markup + '</div><div class="astro-news-group astro-news-copy" aria-hidden="true">' + markup.replace(/<a /g, '<a tabindex="-1" ') + '</div>';
    offset = 0; viewport.scrollLeft = 0; motion();
  }

  async function load() {
    if (loading) return;
    loading = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('data/news-feeds.json', { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw Error('Headlines unavailable');
      const data = readSnapshot(await response.json()), items = usable(data);
      if (!items.length) throw Error('No fresh headlines');
      saved = data; render(items);
      status.textContent = 'Universe Today headlines updated.';
    } catch (_) {
      const previous = usable(saved);
      render(previous.length ? previous : [{ title: 'Headlines unavailable · Read the latest on Universe Today ↗', link: SITE }]);
      status.textContent = previous.length ? 'Refresh unavailable; recent Universe Today headlines retained.' : 'Headlines unavailable. Open Universe Today for the latest.';
    } finally { clearTimeout(timer); loading = false; }
  }

  viewport.addEventListener('mouseenter', () => { hover = true; motion(); });
  viewport.addEventListener('mouseleave', () => { hover = false; motion(); });
  viewport.addEventListener('focusin', () => { focus = true; motion(); });
  viewport.addEventListener('focusout', event => {
    if (!viewport.contains(event.relatedTarget)) {
      focus = false; viewport.scrollLeft = 0; motion();
      if (pending) render(pending);
    }
  });
  reduced.addEventListener('change', motion);
  root.addEventListener('resize', motion);
  document.addEventListener('visibilitychange', () => { motion(); if (!document.hidden) load(); });
  if (document.fonts?.ready) document.fonts.ready.then(motion);
  setInterval(() => { if (!document.hidden) load(); }, 15 * 60000);
  load();
})(globalThis);
