const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { featured, webURL, normalizeStation, mergeStations, localMatches, searchParams, Directory, Player } = require('../assets/radio-core.js');
// Exercise the direct-audio path independently of featured stations' formats.
const station = { ...featured[1], url: 'https://example.com/live.mp3', hls: false };
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
  for (const [, file] of html.matchAll(/(?:src|href)="(assets\/[^\"]+)"/g)) assert(fs.existsSync(path.join(root, file.split('?')[0])), file);
  assert.match(html, /integrity="sha384-/); assert(!html.includes(' autoplay'));
});

test('repeated buffering events cannot postpone the playback timeout indefinitely', () => {
  const { player, audios, timers, states } = harness(); player.play(station);
  const original = [...timers.keys()][0];
  audios[0].events.waiting(); audios[0].events.waiting();
  assert.equal(timers.size, 1); assert.equal([...timers.keys()][0], original);
  timers.get(original)(); assert.equal(states.at(-1).state, 'error');
});


function mediaHarness(callbacks = {}) {
  const actions = {}, positions = [];
  const session = { setActionHandler(action, handler) { actions[action] = handler; }, setPositionState(...args) { positions.push(args); } };
  const controls = new (require('../assets/radio-core.js').MediaControls)({ session, Metadata: class { constructor(data) { Object.assign(this, data); } }, baseURL: 'https://gregle.uk/radio.html', ...callbacks });
  return { controls, session, actions, positions };
}

test('Now Playing follows station switches, playback state and locally hosted artwork', () => {
  const { controls, session, positions } = mediaHarness();
  controls.update({ station: featured[0], state: 'loading' });
  assert.equal(session.metadata.title, 'BBC Radio 1');
  assert.equal(session.metadata.artwork[0].src, 'https://gregle.uk/assets/radio-logos/bbc-radio-1.png');
  assert.equal(session.playbackState, 'none');
  controls.update({ station: featured[0], state: 'playing' });
  controls.update({ station: featured[0], state: 'loading' });
  assert.equal(session.playbackState, 'playing'); // Buffering does not advertise a paused stream.
  controls.update({ station: featured[1], state: 'loading' });
  assert.equal(session.metadata.title, 'NRK P3');
  assert.equal(session.metadata.artwork[0].src, 'https://gregle.uk/assets/radio-logos/nrk-p3.png');
  assert.equal(session.playbackState, 'none');
  controls.update({ station: featured[1], state: 'paused' });
  assert.equal(session.playbackState, 'paused');
  controls.update({ station: featured[2], state: 'playing' });
  assert.match(session.metadata.artwork[0].src, /assets\/radio-app\/icon-512.png$/);
  assert(positions.every(args => args.length === 0)); // Live streams have no invented seek position.
});

test('Now Playing actions control the current player and clear on stop or stream failure', () => {
  const h = harness();
  const { controls, session, actions } = mediaHarness({ onPlay: () => h.player.resume(), onPause: () => h.player.pause(), onStop: () => h.player.stop() });
  h.player.onChange = update => { h.states.push(update); controls.update(update); };
  h.player.play(station); h.audios[0].events.playing();
  actions.pause(); assert.equal(h.audios[0].paused, true); assert.equal(session.playbackState, 'paused');
  actions.play(); assert.equal(h.audios[0].playCount, 2);
  h.player.play(featured[4]); h.audios[1].events.playing();
  actions.pause(); actions.play(); assert.equal(h.audios[1].playCount, 2); assert.equal(h.audios[0].playCount, 2);
  for (const action of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) assert.equal(actions[action], null);
  actions.stop(); assert.equal(session.metadata, null); assert.equal(session.playbackState, 'none');
  assert.equal(actions.play, null); assert.equal(actions.pause, null); assert.equal(actions.stop, null);
  h.player.play(station); h.audios[2].events.error();
  assert.equal(session.metadata, null); assert.equal(session.playbackState, 'none');
});

test('unsupported or partial Media Session APIs never interrupt the radio player', () => {
  const { MediaControls } = require('../assets/radio-core.js');
  const unsupported = new MediaControls({ session: null });
  assert.doesNotThrow(() => { unsupported.update({ station, state: 'playing' }); unsupported.clear(); });
  const partial = new MediaControls({ session: { set metadata(value) { throw new Error('Unsupported'); }, set playbackState(value) { throw new Error('Unsupported'); } }, Metadata: class {} });
  assert.doesNotThrow(() => { partial.update({ station, state: 'playing' }); partial.clear(); });
});

test('media-screen resume catches playback rejection without losing the selected station', async () => {
  const h = harness(); h.player.play(station); h.audios[0].events.playing(); h.player.pause();
  h.audios[0].play = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
  h.player.resume(); await flush();
  assert.equal(h.states.at(-1).state, 'paused'); assert.equal(h.states.at(-1).station.id, station.id);
  assert.match(h.states.at(-1).message, /Press play/);
});

test('radio installs with its own name, start page and correctly sized PNG icons', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'radio.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Gregle Radio'); assert.equal(manifest.start_url, '/radio.html');
  assert.equal(manifest.id, '/radio.html'); assert.equal(manifest.display, 'standalone');
  for (const icon of [...manifest.icons, { src: '/assets/radio-app/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes);
  }
  const html = fs.readFileSync(path.join(root, 'radio.html'), 'utf8');
  assert.match(html, /name="apple-mobile-web-app-title" content="Gregle Radio"/);
  assert.match(html, /rel="apple-touch-icon"[^>]+href="\/assets\/radio-app\/apple-touch-icon.png"/);
  assert.match(html, /rel="manifest" href="\/radio.webmanifest"/);
});

test('NRK P3 uses its live HLS manifest in native players', () => {
  const p3 = featured.find(s => s.id === 'nrk-p3');
  assert.equal(p3.hls, true);
  assert.match(p3.url, /^https:\/\/nrk-live-radio-world\.akamaized\.net\/p3\/muxed\.m3u8\?/);
  const h = harness(), create = h.player.createAudio;
  h.player.createAudio = () => { const a = create(); a.canPlayType = () => 'probably'; return a; };
  h.player.play(p3);
  assert.equal(h.audios[0].src, p3.url);
  h.audios[0].events.playing();
  assert.equal(h.states.at(-1).state, 'playing');
  h.player.stop();
});

test('an interrupted live stream reconnects, but repeated disconnects exhaust its budget', () => {
  const h = harness(); h.player.play(station);
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = h.audios.at(-1); a.events.playing(); a.ended = true;
    a.events.pause(); a.events.ended();
    assert.equal(h.states.at(-1).state, 'loading');
    assert.match(h.states.at(-1).message, /Reconnecting/);
    assert.equal(a.removed, true);
    assert.equal(h.timers.size, 1);
    [...h.timers.values()][0]();
    assert.equal(h.audios.length, attempt + 2);
    a.events.ended(); // Old events cannot schedule another attempt.
    assert.equal(h.timers.size, 1);
  }
  h.audios.at(-1).events.playing(); h.audios.at(-1).events.ended();
  assert.equal(h.states.at(-1).state, 'error');
  assert.equal(h.timers.size, 0);
});

test('Stop, Pause and station switches cancel pending reconnects, including stale callbacks', () => {
  for (const action of ['stop', 'pause', 'switch']) {
    const h = harness(); h.player.play(station); h.audios[0].events.playing(); h.audios[0].events.ended();
    const pending = [...h.timers.values()][0];
    if (action === 'switch') h.player.play(featured[4]); else h.player[action]();
    pending();
    assert.equal(h.audios.length, action === 'switch' ? 2 : 1);
    assert.equal(h.states.at(-1).state, {stop:'stopped',pause:'paused',switch:'loading'}[action]);
    h.player.stop();
  }
});

test('network loss and prolonged buffering reconnect; decode errors and deliberate pauses do not', () => {
  for (const failure of ['network', 'buffer', 'decode', 'pause']) {
    const h = harness(); h.player.play(station); const a = h.audios[0]; a.events.playing();
    if (failure === 'buffer') { a.events.waiting(); [...h.timers.values()][0](); }
    else if (failure === 'pause') { h.player.pause(); a.events.ended(); }
    else { a.error = {code: failure === 'network' ? 2 : 3}; a.events.error(); }
    assert.equal(h.states.at(-1).state, failure === 'decode' ? 'error' : failure === 'pause' ? 'paused' : 'loading');
    assert.equal(h.timers.size, ['network','buffer'].includes(failure) ? 1 : 0);
    h.player.stop();
  }
});

test('NRK P3 uses Hls.js without native HLS and recovers a fatal network interruption', () => {
  const instances = [];
  class Hls {
    static Events = { MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'parsed', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError' };
    static isSupported = () => true;
    constructor() { this.events = {}; instances.push(this); }
    on(name, fn) { this.events[name] = fn; }
    attachMedia(audio) { this.audio = audio; }
    loadSource(url) { this.url = url; }
    destroy() { this.destroyed = true; }
  }
  const h = harness(Hls), p3 = featured.find(s => s.id === 'nrk-p3');
  h.player.play(p3); const engine = instances[0]; engine.events.attached(); engine.events.parsed();
  assert.equal(engine.url, p3.url);
  h.audios[0].events.playing();
  engine.events.error(null, {fatal:true, type:'networkError'});
  assert.equal(engine.destroyed, true); assert.equal(h.states.at(-1).state, 'loading');
  [...h.timers.values()][0]();
  assert.equal(instances.length, 2);
  h.player.stop(); engine.events.error(null, {fatal:true, type:'networkError'});
  assert.equal(h.timers.size, 0); assert.equal(h.states.at(-1).state, 'stopped');
});
