/* Shared radio data and playback logic. No framework or API key required. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleRadio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const bbc = (channel, pool) => `https://as-hls-ww.live.cf.md.bbci.co.uk/pool_${pool}/live/ww/${channel}/${channel}.isml/${channel}-audio%3d96000.norewind.m3u8`;
  const nrk = channel => `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/${channel}`;
  const featured = [
    { id: 'bbc-radio-1', name: 'BBC Radio 1', artwork: { src: 'assets/radio-logos/bbc-radio-1.png', sizes: '600x600', type: 'image/png' }, country: 'GB', tags: 'New music · Pop · Dance', url: bbc('bbc_radio_one', '01505109'), hls: true, homepage: 'https://www.bbc.co.uk/sounds/play/live:bbc_radio_one' },
    // Use the segmented live feed published by NRK's playback manifest. A single
    // Icecast connection can close early, leaving native players at end-of-file.
    { id: 'nrk-p3', name: 'NRK P3', artwork: { src: 'assets/radio-logos/nrk-p3.png', sizes: '512x512', type: 'image/png' }, country: 'NO', tags: 'Norwegian music · Pop · Entertainment', url: 'https://nrk-live-radio-world.akamaized.net/p3/muxed.m3u8?adap=audio&aco=aac', hls: true, homepage: 'https://radio.nrk.no/direkte/p3' },
    { id: 'bbc-radio-2', name: 'BBC Radio 2', country: 'GB', tags: 'Music · Entertainment', url: bbc('bbc_radio_two', '74208725'), hls: true, homepage: 'https://www.bbc.co.uk/sounds/play/live:bbc_radio_two' },
    { id: 'bbc-6-music', name: 'BBC Radio 6 Music', country: 'GB', tags: 'Alternative · Indie · Discovery', url: bbc('bbc_6music', '81827798'), hls: true, homepage: 'https://www.bbc.co.uk/sounds/play/live:bbc_6music' },
    { id: 'nrk-p2', name: 'NRK P2', country: 'NO', tags: 'Culture · Conversation · Music', url: nrk('p2'), homepage: 'https://radio.nrk.no/direkte/p2' },
    { id: 'nrk-mp3', name: 'NRK mP3', country: 'NO', tags: 'Pop · Hits · Dance', url: nrk('mp3'), homepage: 'https://radio.nrk.no/direkte/mp3' },
    { id: 'nrk-p3-musikk', name: 'NRK P3 Musikk', country: 'NO', tags: 'Music · Pop · Discovery', url: nrk('p3musikk'), homepage: 'https://radio.nrk.no/direkte/p3musikk' },
    { id: 'fip', name: 'FIP', country: 'FR', tags: 'Eclectic · Jazz · World', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
    { id: 'nrk-jazz', name: 'NRK Jazz', country: 'NO', tags: 'Jazz · Instrumental', url: nrk('jazz'), homepage: 'https://radio.nrk.no/direkte/jazz' },
    { id: 'radio-paradise', name: 'Radio Paradise', country: 'US', tags: 'Eclectic · Rock · World', url: 'https://stream.radioparadise.com/mp3-128', homepage: 'https://radioparadise.com/' }
  ];
  function webURL(value, httpsOnly = false) {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  const text = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
  function normalizeStation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const url = webURL(raw.url_resolved || raw.url, true);
    const name = text(raw.name);
    if (!url || !name) return null;
    const uuid = /^[a-f0-9-]{36}$/i.test(raw.stationuuid || '') ? raw.stationuuid : '';
    return { id: uuid || url, uuid, name, url, country: /^[A-Z]{2}$/.test(raw.countrycode) ? raw.countrycode : '',
      tags: text(raw.tags).split(',').filter(Boolean).slice(0, 3).join(' · '),
      homepage: webURL(raw.homepage), hls: raw.hls === 1 || /\.m3u8(?:\?|$)/i.test(url) };
  }
  function mergeStations(items) {
    const urls = new Set(), names = new Set();
    return items.filter(station => {
      if (!station) return false;
      const key = `${station.country}:${station.name.toLowerCase()}`;
      if (urls.has(station.url) || names.has(key)) return false;
      urls.add(station.url); names.add(key); return true;
    });
  }
  function localMatches(query, country) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return featured.filter(station => (!country || station.country === country) &&
      terms.every(term => `${station.name} ${station.tags}`.toLowerCase().includes(term)));
  }
  function searchParams(query, country, offset = 0) {
    const params = new URLSearchParams({ name: query.trim(), hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true', limit: '30', offset: String(offset) });
    if (/^[A-Z]{2}$/.test(country)) params.set('countrycode', country);
    return params;
  }
  // Publish the selected live station to iOS Lock Screen / Control Centre and media keys.
  // Every API call is optional: older browsers must still be able to play radio.
  class MediaControls {
    constructor({ session = globalThis.navigator?.mediaSession, Metadata = globalThis.MediaMetadata,
      baseURL = globalThis.location?.href, onPlay, onPause, onStop } = {}) {
      this.session = session; this.Metadata = Metadata; this.baseURL = baseURL;
      this.handlers = { play: onPlay, pause: onPause, stop: onStop };
      this.stationId = null; this.state = 'none';
    }
    attempt(action) { try { action(); } catch (_) { /* Unsupported platform feature. */ } }
    update({ station, state }) {
      if (!this.session) return;
      if (!station || state === 'stopped' || state === 'error') { this.clear(); return; }
      const sameStation = this.stationId === station.id;
      this.stationId = station.id;
      this.attempt(() => {
        if (!this.Metadata) return;
        const artwork = station.artwork || { src: 'assets/radio-app/icon-512.png', sizes: '512x512', type: 'image/png' };
        this.session.metadata = new this.Metadata({
          title: station.name,
          artist: 'Live radio · Gregle',
          album: '',
          artwork: [{ ...artwork, src: new URL(artwork.src, this.baseURL).href }]
        });
      });
      this.state = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' :
        sameStation && this.state === 'playing' ? 'playing' : 'none';
      this.attempt(() => { this.session.playbackState = this.state; });
      for (const [action, handler] of Object.entries(this.handlers)) {
        this.attempt(() => this.session.setActionHandler(action, handler || null));
      }
      // This is live radio: do not advertise a seekable track or invent a duration.
      for (const action of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) {
        this.attempt(() => this.session.setActionHandler(action, null));
      }
      this.attempt(() => this.session.setPositionState());
    }
    clear() {
      if (!this.session) return;
      this.stationId = null; this.state = 'none';
      this.attempt(() => { this.session.metadata = null; });
      this.attempt(() => { this.session.playbackState = 'none'; });
      for (const action of Object.keys(this.handlers)) this.attempt(() => this.session.setActionHandler(action, null));
      this.attempt(() => this.session.setPositionState());
    }
  }
  class Directory {
    constructor(fetcher = (...args) => fetch(...args)) {
      this.fetcher = fetcher;
      this.servers = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info'];
      if (Math.random() < .5) this.servers.reverse();
    }
    async request(path, signal) {
      for (const server of [...this.servers]) {
        if (signal?.aborted) throw new Error('Cancelled');
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 7000);
        try {
          const response = await this.fetcher(server + path, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw new Error('Directory unavailable');
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('Invalid directory response');
          return data;
        } catch (error) {
          if (signal?.aborted) throw error;
        } finally {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
        }
      }
      throw new Error('Directory unavailable');
    }
    async discover() {
      try {
        const rows = await this.request('/json/servers');
        const hosts = [...new Set(rows.map(row => row?.name).filter(name => typeof name === 'string' && /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(name)))];
        if (hosts.length) {
          const offset = Math.floor(Math.random() * hosts.length);
          this.servers = [...hosts.slice(offset), ...hosts.slice(0, offset)].map(name => 'https://' + name);
          if (!this.servers.includes('https://all.api.radio-browser.info')) this.servers.push('https://all.api.radio-browser.info');
        }
      } catch (_) { /* Keep the bootstrap servers and locally featured stations. */ }
    }
    search(query, country, offset, signal) {
      return this.request('/json/stations/search?' + searchParams(query, country, offset), signal);
    }
    recordClick(station) {
      if (!station.uuid) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      this.fetcher(this.servers[0] + '/json/url/' + encodeURIComponent(station.uuid), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
        .catch(() => {}).finally(() => clearTimeout(timer));
    }
  }
  class Player {
    constructor({ createAudio, Hls, onChange, timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) } }) {
      this.createAudio = createAudio; this.Hls = Hls; this.onChange = onChange; this.timers = timers;
      this.generation = 0; this.volume = .8;
    }
    release() {
      ++this.generation;
      this.resumeAudio = null;
      this.timers.clearTimeout(this.timer); this.timer = null;
      if (this.hls) { this.hls.destroy(); this.hls = null; }
      if (this.audio) {
        this.volume = this.audio.volume;
        this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio.remove(); this.audio = null;
      }
    }
    pause() {
      if (this.audio) this.audio.pause();
      else if (this.station) {
        // A media-key pause must also cancel a pending reconnect.
        this.release(); this.onChange({ state: 'paused', station: this.station });
      }
    }
    resume() {
      if (this.resumeAudio) this.resumeAudio();
      else if (this.station) this.play(this.station);
    }
    stop() { this.release(); this.onChange({ state: 'stopped', station: this.station }); }
    play(station, reconnects = 0) {
      this.release(); this.station = station;
      if (!webURL(station.url, true)) { this.onChange({ state: 'error', station, message: 'This station does not have a secure stream. Try its website.' }); return; }
      const token = this.generation;
      const audio = this.audio = this.createAudio();
      audio.controls = true; audio.preload = 'none'; audio.volume = this.volume;
      audio.setAttribute('aria-label', station.name + ' live radio player');
      const active = () => token === this.generation;
      let hasPlayed = false, userPaused = false;
      const update = (state, message) => { if (active()) this.onChange({ state, station, message }); };
      const fail = message => {
        if (!active()) return;
        this.release(); this.onChange({ state: 'error', station, message });
      };
      const reconnect = message => {
        if (!active() || userPaused) return;
        // Retry only an interrupted, previously playing stream, with a finite
        // budget. Explicit Play/Reconnect starts a new budget; Stop cancels it.
        if ((!hasPlayed && reconnects === 0) || reconnects >= 3) { fail(message); return; }
        this.release();
        const retryToken = this.generation;
        this.onChange({ state: 'loading', station, message: 'Connection interrupted. Reconnecting…' });
        this.timer = this.timers.setTimeout(() => {
          if (retryToken === this.generation) this.play(station, reconnects + 1);
        }, 1000 * (reconnects + 1));
      };
      const buffer = () => {
        if (!active() || userPaused) return;
        update('loading');
        if (this.timer) return;
        this.timer = this.timers.setTimeout(() => reconnect('The station is taking too long to respond. Retry or open its website.'), 20000);
      };
      const start = () => {
        if (!active()) return;
        userPaused = false;
        audio.play().catch(error => {
          if (!active() || error.name === 'AbortError') return;
          if (error.name === 'NotAllowedError') {
            userPaused = true;
            this.timers.clearTimeout(this.timer); this.timer = null; update('paused', 'Press play in the audio controls to start listening.');
          } else fail('This stream could not play here. Retry or open the station website.');
        });
      };
      this.resumeAudio = start;
      audio.addEventListener('play', () => { if (active()) userPaused = false; });
      audio.addEventListener('playing', () => { if (active()) { hasPlayed = true; this.timers.clearTimeout(this.timer); this.timer = null; update('playing'); } });
      audio.addEventListener('waiting', buffer);
      audio.addEventListener('pause', () => { if (active() && !audio.ended && !audio.error) { userPaused = true; this.timers.clearTimeout(this.timer); this.timer = null; update('paused'); } });
      audio.addEventListener('error', () => {
        const message = 'This stream is unavailable or cannot play in this browser. Try its website.';
        if (audio.error?.code === 2) reconnect(message); else fail(message);
      });
      audio.addEventListener('ended', () => reconnect('The station ended its stream. Retry to reconnect.'));
      buffer();
      if (station.hls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        if (!this.Hls?.isSupported()) { fail('This browser could not load this station’s player. Try its website.'); return; }
        try {
          const hls = this.hls = new this.Hls({ enableWorker: true, maxBufferLength: 30, backBufferLength: 0 });
          hls.on(this.Hls.Events.MEDIA_ATTACHED, () => { if (active()) hls.loadSource(station.url); });
          hls.on(this.Hls.Events.MANIFEST_PARSED, start);
          hls.on(this.Hls.Events.ERROR, (_, data) => {
            if (!data.fatal) return;
            const message = 'The station connection failed. Retry or open its website.';
            if (data.type === this.Hls.ErrorTypes?.NETWORK_ERROR) reconnect(message); else fail(message);
          });
          hls.attachMedia(audio);
        } catch (_) { fail('The station player could not start. Try its website.'); }
      } else { audio.src = station.url; start(); }
    }
  }
  return { featured, webURL, normalizeStation, mergeStations, localMatches, searchParams, Directory, Player, MediaControls };
});

