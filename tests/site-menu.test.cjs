const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');

test('every content page has the same nine valid app destinations and working icons', () => {
  const expected = ['/', '/translate.html', '/weather.html', '/earthquakes.html', '/astro.html', '/sports.html', '/news.html', '/finance.html', '/links.html'];
  for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'environment-canada.html')) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal((source.match(/id="gregleAppMenu"/g) || []).length, 1, file);
    const menu = source.match(/<!-- Gregle app menu -->([\s\S]*?)<!-- \/Gregle app menu -->/)[1];
    assert.equal((source.match(/id="themeToggle"/g) || []).length, 1, file);
    assert.match(menu, /<div class="gregle-menu-heading"><h2>Gregle apps<\/h2><button class="gregle-theme-switch" id="themeToggle"[^>]*role="switch"[^>]*aria-label="Dark mode"[^>]*aria-checked="false"/, file);
    assert(!source.includes('class="pill theme-toggle"'), file);
    assert(!source.includes('id="brandToggle"'), file);
    const apps = [...menu.matchAll(/<a class="gregle-app" href="([^"]+)"[^>]*><img src="([^"]+)"/g)];
    assert.deepEqual(apps.map(a => a[1]), expected, file);
    for (const [,href,icon] of apps) {
      assert(fs.existsSync(path.join(root, href === '/' ? 'index.html' : href.slice(1))), href);
      assert(fs.existsSync(path.join(root, icon.slice(1))), icon);
    }
    assert(source.includes('assets/site-menu.css?'), file);
    assert(source.includes('assets/site-menu.js?'), file);
    const headerWithoutMenu = source.match(/<header\b[\s\S]*?<\/header>/)[0].replace(/<!-- Gregle app menu -->[\s\S]*?<!-- \/Gregle app menu -->/, '');
    assert(!/<a\b[^>]*>\s*←?\s*(?:Home|Tools|All tools|Back to Gregle)\s*<\/a>/i.test(headerWithoutMenu), file);
    const current = [...menu.matchAll(/href="([^"]+)" aria-current="page"/g)].map(m => m[1]);
    assert.deepEqual(current, expected.includes('/'+file) ? ['/'+file] : file === 'index.html' ? ['/'] : [], file);
  }
});

test('homepage retains the additional menu links', () => {
  const source = fs.readFileSync(path.join(root,'index.html'),'utf8');
  for (const href of ['https://portal.gregle.de','https://42.gsuth.uk','https://maps.apple.com','https://music.apple.com','https://gregle.uk/radio.html','https://spaceweather.com','https://news.ycombinator.com','https://xkcd.com','https://gsuth.uk']) assert(source.includes('href="'+href+'"'),href);
});

test('generated menu markup stays in sync with the shared configuration', () => {
  execFileSync('python3', ['scripts/update_site_menu.py','--check'], {cwd:root});
});

test('launcher supports arrow navigation, Escape, outside clicks and normal Tab exits', () => {
  let focused;
  const node = () => ({listeners:{},attrs:{},addEventListener(k,f){this.listeners[k]=f;},setAttribute(k,v){this.attrs[k]=v;},focus(){focused=this;}});
  const summary=node(),panel=node(),apps=Array.from({length:9},node),menu=node(),document=node(),window=node();
  menu.open=false; menu.hasAttribute=()=>true;
  menu.querySelector=s=>s==='summary'?summary:panel;
  menu.querySelectorAll=()=>apps;
  menu.style={setProperty(){}};
  menu.contains=n=>[menu,summary,panel,...apps].includes(n);
  summary.getBoundingClientRect=()=>({bottom:60});
  document.getElementById=()=>menu; window.innerHeight=700;
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/site-menu.js'),'utf8'),{document,window});
  const key=(key,target)=>({key,target,preventDefault(){this.prevented=true;}});
  summary.listeners.keydown(key('ArrowDown',summary));
  assert(menu.open); assert.equal(focused,apps[0]); assert.equal(summary.attrs['aria-expanded'],'true');
  panel.listeners.keydown(key('ArrowDown',apps[0])); assert.equal(focused,apps[3]);
  panel.listeners.keydown(key('ArrowLeft',apps[0])); assert.equal(focused,apps[8]);
  panel.listeners.keydown(key('Home',apps[8])); assert.equal(focused,apps[0]);
  panel.listeners.keydown(key('End',apps[0])); assert.equal(focused,apps[8]);
  document.listeners.keydown(key('Escape',apps[8])); assert(!menu.open); assert.equal(focused,summary);
  menu.open=true; document.listeners.click({target:summary}); assert(menu.open);
  document.listeners.click({target:{}}); assert(!menu.open);
  menu.open=true; menu.listeners.focusout({relatedTarget:apps[0]}); assert(menu.open);
  menu.listeners.focusout({relatedTarget:{}}); assert(!menu.open);
});
