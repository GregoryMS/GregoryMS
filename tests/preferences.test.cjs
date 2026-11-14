const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/preferences.js'), 'utf8');

function browser(cookies = new Map(), hostname = 'gregle.uk', saved = {}, blocked = {}) {
  const values = new Map(Object.entries(saved)), events = {}, documentEvents = {}, intervals = [], writes = [];
  const node = () => ({classes:new Set(), attrs:{}, classList:{toggle(name, on) {if (on) this.owner.classes.add(name); else this.owner.classes.delete(name);}}, setAttribute(name, value) {this.attrs[name] = value;}});
  const html = node(), body = node(), toggle = node(), brand = node();
  html.classList.owner = html; body.classList.owner = body;
  const media = {matches:false, addEventListener(event, fn) {this.changed = fn;}};
  const doc = {documentElement:html, body, hidden:false, getElementById:id => id === 'themeToggle' ? toggle : id === 'brandThemeToggle' ? brand : null,
    addEventListener(event, fn) {documentEvents[event] = fn;}};
  Object.defineProperty(doc, 'cookie', {
    get() {if (blocked.cookies) throw Error('blocked cookies'); return [...cookies].map(([key, value]) => key + '=' + value).join('; ');},
    set(value) {if (blocked.cookies) throw Error('blocked cookies'); writes.push(value); const [pair] = value.split(';'), separator = pair.indexOf('='); cookies.set(pair.slice(0, separator), pair.slice(separator + 1));}
  });
  const win = {document:doc, location:{hostname, protocol:'https:'}, matchMedia:() => media,
    localStorage:{getItem(key) {if (blocked.storage) throw Error('blocked storage'); return values.get(key) || null;}, setItem(key, value) {if (blocked.storage) throw Error('blocked storage'); values.set(key, value);}},
    addEventListener(event, fn) {events[event] = fn;}, setInterval(fn) {intervals.push(fn);}};
  win.window = win;
  vm.runInNewContext(source, win);
  return {api:win.GreglePreferences, doc, html, body, toggle, brand, values, writes, cookies, media, events, documentEvents, poll:() => intervals.forEach(fn => fn())};
}

test('menu and theme persist from the homepage to sibling subdomains and reloads', () => {
  const cookies = new Map(), home = browser(cookies);
  const order = ['/', '/maps.html', 'calendar', '/links.html'];
  home.api.setOrder(order); home.api.setTheme('dark');
  const maps = browser(cookies, 'maps.gregle.uk');
  assert.deepEqual(Array.from(maps.api.getOrder()), order); assert.equal(maps.api.getTheme(), 'dark');
  assert(maps.html.classes.has('dark-mode')); assert.equal(maps.toggle.attrs['aria-checked'], 'true');
  assert(home.writes.every(value => /Domain=gregle\.uk/.test(value) && /Secure/.test(value) && /Max-Age=31536000/.test(value) && /SameSite=Lax/.test(value)));
  assert.equal(browser(cookies, 'weather.gregle.uk').api.getTheme(), 'dark');
});

test('already open pages receive changes without sharing localStorage', () => {
  const cookies = new Map(), home = browser(cookies), maps = browser(cookies, 'maps.gregle.uk');
  let notifications = 0; maps.api.subscribe(() => notifications++);
  home.api.setOrder(['/maps.html', '/', '/links.html']); home.api.setTheme('dark'); maps.poll();
  assert.equal(notifications, 1); assert(maps.body.classes.has('dark-mode'));
  assert.deepEqual(Array.from(maps.api.getOrder()), ['/maps.html', '/', '/links.html']);
  maps.api.setTheme('light'); home.events.focus(); assert(!home.html.classes.has('dark-mode'));
  maps.api.setTheme('dark'); home.events.pageshow(); assert(home.html.classes.has('dark-mode'));
});

test('new shared preferences win over old per-page settings', () => {
  const cookies = new Map(), home = browser(cookies);
  home.api.setTheme('dark'); home.api.setOrder(['/', '/maps.html', '/links.html']);
  const maps = browser(cookies, 'maps.gregle.uk', {'gregle-theme':'light', 'gregle-app-order':'["/radio.html","/"]'});
  assert.equal(maps.api.getTheme(), 'dark'); assert.equal(maps.values.get('gregle-theme'), 'dark');
  assert.deepEqual(Array.from(maps.api.getOrder()), ['/', '/maps.html', '/links.html']);
});

test('existing rearrangements migrate once and remain shared on other pages', () => {
  const cookies = new Map(), home = browser(cookies, 'gregle.uk', {'gregle-theme':'dark', 'gregle-app-order':'["/radio.html","/maps.html","/links.html"]'});
  const maps = browser(cookies, 'maps.gregle.uk');
  assert.equal(home.api.getTheme(), 'dark'); assert.equal(maps.api.getTheme(), 'dark');
  assert.deepEqual(Array.from(maps.api.getOrder()), ['/radio.html', '/maps.html', '/links.html']);
});

test('system appearance is followed until the user saves a manual choice', () => {
  const h = browser(); assert(!h.html.classes.has('dark-mode'));
  h.media.matches = true; h.media.changed(); assert(h.html.classes.has('dark-mode'));
  h.api.setTheme('light'); h.media.changed(); assert(!h.html.classes.has('dark-mode'));
  assert.equal(h.brand.attrs['aria-pressed'], 'false');
});

test('hidden pages sync when shown and before a restored page is used', () => {
  const cookies = new Map(), home = browser(cookies), maps = browser(cookies, 'maps.gregle.uk');
  home.doc.hidden = true; maps.api.setTheme('dark'); home.poll(); assert(!home.html.classes.has('dark-mode'));
  home.doc.hidden = false; home.documentEvents.visibilitychange(); assert(home.html.classes.has('dark-mode'));
});

test('cookies keep preferences working when localStorage is blocked', () => {
  const cookies = new Map(), home = browser(cookies, 'gregle.uk', {}, {storage:true});
  home.api.setTheme('dark'); home.api.setOrder(['/', '/links.html']);
  const maps = browser(cookies, 'maps.gregle.uk', {}, {storage:true});
  assert.equal(maps.api.getTheme(), 'dark'); assert.deepEqual(Array.from(maps.api.getOrder()), ['/', '/links.html']);
});

test('local persistence and usable toggles remain when cookies are blocked', () => {
  const h = browser(new Map(), 'gregle.uk', {}, {cookies:true});
  h.api.setTheme('dark'); h.api.setOrder(['/', '/links.html']);
  assert.equal(h.values.get('gregle-theme'), 'dark'); assert(h.html.classes.has('dark-mode'));
  const unavailable = browser(new Map(), 'gregle.uk', {}, {cookies:true, storage:true});
  unavailable.api.setTheme('dark'); unavailable.poll(); assert(unavailable.html.classes.has('dark-mode'));
});

test('invalid stored preferences are ignored and menu data is deduplicated', () => {
  const cookies = new Map([['gregle-theme', '%E0%A4%A'], ['gregle-app-order', encodeURIComponent('{bad')]]);
  const h = browser(cookies); assert.equal(h.api.getTheme(), null); assert.equal(h.api.getOrder(), null);
  h.api.setOrder(['/', '/', null, {}, '/links.html']);
  assert.deepEqual(Array.from(h.api.getOrder()), ['/', '/links.html']);
  h.api.setTheme('unexpected'); assert.equal(h.api.getTheme(), null);
});

test('theme and menu writes are independent so simultaneous edits are retained', () => {
  const cookies = new Map(), home = browser(cookies), maps = browser(cookies, 'maps.gregle.uk');
  home.api.setOrder(['/radio.html', '/', '/links.html']); maps.api.setTheme('dark');
  home.poll(); maps.poll();
  assert.equal(home.api.getTheme(), 'dark');
  assert.deepEqual(Array.from(maps.api.getOrder()), ['/radio.html', '/', '/links.html']);
});
