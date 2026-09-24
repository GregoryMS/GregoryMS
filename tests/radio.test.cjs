const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { featured, webURL, normalizeStation, mergeStations, localMatches, searchParams, Directory, Player } = require('../assets/radio-core.js');
const station = featured[1];
const flush = () => new Promise(resolve => setImmediate(resolve));

test('radio streams and external links reject executable, credentialed and insecure stream URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'ftp://example.com/a', 'https://user:pass@example.com/']) assert.equal(webURL(url), '');
  assert.equal(normalizeStation({ name: 'Bad', url: 'http://example.com/radio' }), null);
  assert.equal(normalizeStation({ name: '', url: 'https://example.com/radio' }), null);
  assert.equal(normalizeStation(null), null);
  const result = normalizeStation({ name: '<img onerror=alert(1)>', url_resolved: 'https://example.com/a.m3u8', countrycode: 'NO', homepage: 'javascript:alert(1)', tags: 'rock,jazz,pop,news' });
  assert.equal(result.name, '<img onerror=alert(1)>'); // The DOM renderer uses textContent.
  assert.equal(result.homepage, ''); assert.equal(result.hls, true); assert.equal(result.tags, 'rock · jazz · pop');
  assert(featured.length >= 10); assert(featured.every(s => webURL(s.url, true) && webURL(s.homepage)));
});

test('country and station search combine filters, encode text and preserve directory pagination', () => {
  const params = searchParams(' BBC & jazz ', 'NO', 30);
  assert.equal(params.get('name'), 'BBC & jazz'); assert.equal(params.get('countrycode'), 'NO');
  assert.equal(params.get('offset'), '30'); assert.equal(params.get('limit'), '30');
  assert.equal(params.get('is_https'), 'true'); assert.equal(params.get('hidebroken'), 'true');
  assert.equal(searchParams('', 'Norway').has('countrycode'), false);
  assert.deepEqual(localMatches('NRK p3', 'NO').map(s => s.id), ['nrk-p3', 'nrk-mp3', 'nrk-p3-musikk']);
  assert.deepEqual(localMatches('BBC', 'NO'), []);
  assert.equal(mergeStations([station, { ...station, id: 'alternate', url: 'https://example.com/a' }, null]).length, 1);
});

test('directory retries a failed server and discovers only valid directory hosts', async () => {
  const calls = [];
  const directory = new Directory(async url => {
    calls.push(url);
    if (url.startsWith('https://first.example')) throw new Error('Offline');
    return { ok: true, json: async () => url.endsWith('/json/servers') ? [{ name: 'de1.api.radio-browser.info' }, { name: 'evil.example' }, { name: 'de1.api.radio-browser.info' }] : [] };
  });
  directory.servers = ['https://first.example', 'https://second.example'];
  assert.deepEqual(await directory.search('NRK', 'NO', 0), []);
  assert.equal(calls.length, 2);
  await directory.discover();
  assert.deepEqual(directory.servers, ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info']);
});

test('directory cancels pending searches without retrying another host and rejects malformed replies', async () => {
  let calls = 0;
  const directory = new Directory((url, { signal }) => new Promise((resolve, reject) => {
    calls++; signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const controller = new AbortController();
  const pending = directory.search('BBC', '', 0, controller.signal); controller.abort();
  await assert.rejects(pending); assert.equal(calls, 1);
  const malformed = new Directory(async () => ({ ok: true, json: async () => ({ stations: [] }) }));
  await assert.rejects(malformed.search('', '', 0), /unavailable/);
});

function harness(Hls) {
  const states = [], audios = [], timers = new Map(); let id = 0;
  const player = new Player({ Hls, onChange: state => states.push(state),
    timers: { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
    createAudio() {
      const events = {};
      const audio = { events, volume: 1, removed: false, paused: true, playCount: 0,
        setAttribute() {}, addEventListener(name, fn) { events[name] = fn; }, canPlayType: () => '',
        play() { this.paused = false; this.playCount++; return Promise.resolve(); },
        pause() { this.paused = true; events.pause?.(); }, removeAttribute() { this.src = ''; }, load() {}, remove() { this.removed = true; }
      }; audios.push(audio); return audio;
    }
  });
  return { player, states, audios, timers };
}

test('switching stations and Stop release the old stream and ignore its delayed events', () => {
  const { player, states, audios, timers } = harness();
  player.play(station); audios[0].events.playing();
  assert.equal(states.at(-1).state, 'playing'); assert.equal(timers.size, 0);
  player.play(featured[4]);
  assert.equal(audios[0].removed, true); assert.equal(audios[0].paused, true); assert.equal(audios[0].src, '');
  audios[0].events.error(); audios[0].events.playing();
  assert.equal(states.at(-1).station.id, featured[4].id); assert.equal(states.at(-1).state, 'loading');
  player.stop(); audios[1].events.playing();
  assert.equal(states.at(-1).state, 'stopped'); assert.equal(audios[1].removed, true); assert.equal(timers.size, 0);
});

test('timeout and media errors release playback and offer a recoverable error', () => {
  for (const failure of ['timeout', 'error', 'ended']) {
    const { player, states, audios, timers } = harness(); player.play(station);
    if (failure === 'timeout') [...timers.values()][0](); else audios[0].events[failure]();
    assert.equal(states.at(-1).state, 'error'); assert(states.at(-1).message);
    assert.equal(audios[0].removed, true); assert.equal(timers.size, 0);
    player.play(station); audios[1].events.playing(); assert.equal(states.at(-1).state, 'playing');
  }
});

test('native playback rejection asks for a user gesture without falsely claiming to be playing', async () => {
  const h = harness(); const create = h.player.createAudio;
  h.player.createAudio = () => { const audio = create(); audio.play = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })); return audio; };
  h.player.play(station); await flush();
  assert.equal(h.states.at(-1).state, 'paused'); assert.match(h.states.at(-1).message, /Press play/); assert.equal(h.timers.size, 0);
});

test('an old play rejection cannot stop a newly selected station', async () => {
  const h = harness(); const create = h.player.createAudio; let reject;
  h.player.createAudio = () => { const audio = create(); audio.play = () => new Promise((_, fail) => { reject = fail; }); return audio; };
  h.player.play(station); const oldReject = reject;
  h.player.createAudio = create; h.player.play(featured[4]); oldReject(new Error('Late failure')); await flush();
  assert.equal(h.states.at(-1).state, 'loading'); assert.equal(h.audios[1].removed, false); h.player.stop();
});

test('HLS attaches and starts only the selected station, then destroys its engine when stopped', () => {
  const instances = [];
  class Hls {
    static Events = { MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'parsed', ERROR: 'error' };
    static isSupported = () => true;
    constructor() { this.events = {}; instances.push(this); }
    on(name, fn) { this.events[name] = fn; }
    attachMedia(audio) { this.audio = audio; }
    loadSource(url) { this.url = url; }
    destroy() { this.destroyed = true; }
  }
  const { player, audios, states } = harness(Hls);
  player.play(featured[0]); const hls = instances[0];
  hls.events.attached(); assert.equal(hls.url, featured[0].url);
  hls.events.parsed(); assert.equal(audios[0].playCount, 1);
  player.stop(); hls.events.parsed(); hls.events.error(null, { fatal: true });
  assert.equal(hls.destroyed, true); assert.equal(audios[0].playCount, 1); assert.equal(states.at(-1).state, 'stopped');
});

test('native HLS is used where supported and missing HLS support fails usefully', () => {
  const h = harness(); const create = h.player.createAudio;
  h.player.createAudio = () => { const audio = create(); audio.canPlayType = () => 'maybe'; return audio; };
  h.player.play(featured[0]); assert.equal(h.audios[0].src, featured[0].url); assert.equal(h.audios[0].playCount, 1); h.player.stop();
  const missing = harness(); missing.player.play(featured[0]);
  assert.equal(missing.states.at(-1).state, 'error'); assert.equal(missing.audios[0].removed, true);
});

test('radio is linked from Tools and its local scripts and stylesheet exist', () => {
  const root = path.join(__dirname, '..'); const html = fs.readFileSync(path.join(root, 'radio.html'), 'utf8');
  assert.match(fs.readFileSync(path.join(root, 'links.html'), 'utf8'), /href="radio.html"/);
  for (const [, file] of html.matchAll(/(?:src|href)="(assets\/[^\"]+)"/g)) assert(fs.existsSync(path.join(root, file)), file);
  assert.match(html, /integrity="sha384-/); assert(!html.includes(' autoplay'));
});

test('repeated buffering events cannot postpone the playback timeout indefinitely', () => {
  const { player, audios, timers, states } = harness(); player.play(station);
  const original = [...timers.keys()][0];
  audios[0].events.waiting(); audios[0].events.waiting();
  assert.equal(timers.size, 1); assert.equal([...timers.keys()][0], original);
  timers.get(original)(); assert.equal(states.at(-1).state, 'error');
});
