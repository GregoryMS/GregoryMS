const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const routes = require('../assets/site-routes.json');
const destination = page => `https://${routes[page]}/`;

test('every content page has the same valid app destinations and working icons', () => {
  const expected = ['index.html', 'translate.html', 'weather.html', 'earthquakes.html', 'astro.html', 'sports.html', 'news.html', 'finance.html', 'links.html', 'radio.html', 'dictionary.html', 'maps.html'].map(destination).concat(['https://cloud.gregle.uk', 'https://cloud.gregle.uk']);
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
    assert.match(menu, /href="https:\/\/cloud\.gregle\.uk" data-gregle-app-id="docs"><img src="\/assets\/docs-app\/icon\.svg"[^>]*><span>Docs<\/span>/, file);
    for (const [,href,icon] of apps) {
      const host = new URL(href).hostname;
      assert(host === 'cloud.gregle.uk' || Object.values(routes).includes(host), href);
      if (host !== 'cloud.gregle.uk') assert(fs.existsSync(path.join(root, Object.keys(routes).find(page => routes[page] === host))), href);
      assert(fs.existsSync(path.join(root, new URL(icon, 'https://gregle.uk').pathname.slice(1))), icon);
    }
    assert(source.includes('assets/site-menu.css?'), file);
    assert(source.includes('assets/site-menu.js?'), file);
    const headerWithoutMenu = source.match(/<header\b[\s\S]*?<\/header>/)[0].replace(/<!-- Gregle app menu -->[\s\S]*?<!-- \/Gregle app menu -->/, '');
    assert(!/<a\b[^>]*>\s*←?\s*(?:Home|Tools|All tools|Back to Gregle)\s*<\/a>/i.test(headerWithoutMenu), file);
    const current = [...menu.matchAll(/href="([^"]+)" aria-current="page"/g)].map(m => m[1]);
    assert.deepEqual(current, expected.includes(destination(file)) ? [destination(file)] : [], file);
  }
});

test('homepage retains the additional menu links', () => {
  const source = fs.readFileSync(path.join(root,'index.html'),'utf8');
  for (const href of ['https://portal.gregle.de','https://42.gsuth.uk','https://maps.apple.com','https://music.apple.com','https://radio.gregle.uk/','https://spaceweather.com','https://news.ycombinator.com','https://xkcd.com','https://gsuth.uk']) assert(source.includes('href="'+href+'"'),href);
});

test('generated menu markup stays in sync with the shared configuration', () => {
  execFileSync('python3', ['scripts/update_site_menu.py','--check'], {cwd:root});
});

function launcher(saved = null, sharedDestination = false) {
  let focused;
  const node = () => ({listeners:{},attrs:{},addEventListener(k,f){this.listeners[k]=f;},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},focus(){focused=this;},scrollIntoView(){}});
  const summary=node(),panel=node(),grid=node(),status=node(),apps=Array.from({length:11},node),menu=node(),document=node(),window=node();
  grid.children=[...apps];
  grid.querySelectorAll=()=>grid.children;
  grid.append=app=>{grid.children.splice(grid.children.indexOf(app),1);grid.children.push(app);};
  apps.forEach((app,i)=>{
    app.attrs.href='/app-'+i; app.textContent='App '+i;
    if (sharedDestination && i === 10) { app.attrs.href='/app-9'; app.attrs['data-gregle-app-id']='docs'; }
    app.parentElement=grid; app.querySelector=()=>({});
    app.after=other=>{grid.children.splice(grid.children.indexOf(other),1);grid.children.splice(grid.children.indexOf(app)+1,0,other);};
    app.before=other=>{grid.children.splice(grid.children.indexOf(other),1);grid.children.splice(grid.children.indexOf(app),0,other);};
  });
  let stored=saved;
  const localStorage={getItem(){return stored;},setItem(k,v){assert.equal(k,'gregle-app-order');stored=v;}};
  menu.open=false; menu.hasAttribute=()=>true;
  menu.querySelector=s=>({'summary':summary,'nav':panel,'.gregle-app-grid':grid,'[data-gregle-app-status]':status})[s];
  menu.style={setProperty(){}};
  menu.contains=n=>[menu,summary,panel,...apps].includes(n);
  summary.getBoundingClientRect=()=>({bottom:60});
  document.getElementById=()=>menu; window.innerHeight=700;
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/site-menu.js'),'utf8'),{document,window,localStorage,clearTimeout,cancelAnimationFrame(){}});
  return {summary,panel,grid,status,apps,menu,document,window,focused:()=>focused,stored:()=>stored};
}
const key=(key,target,extra={})=>({key,target,...extra,preventDefault(){this.prevented=true;}});

test('launcher supports arrow navigation, Escape, outside clicks and normal Tab exits', () => {
  const env=launcher();
  const {summary,panel,apps,menu,document}=env;
  summary.listeners.keydown(key('ArrowDown',summary));
  assert(menu.open); assert.equal(env.focused(),apps[0]); assert.equal(summary.attrs['aria-expanded'],'true');
  panel.listeners.keydown(key('ArrowDown',apps[0])); assert.equal(env.focused(),apps[3]);
  panel.listeners.keydown(key('ArrowLeft',apps[0])); assert.equal(env.focused(),apps[10]);
  panel.listeners.keydown(key('Home',apps[10])); assert.equal(env.focused(),apps[0]);
  panel.listeners.keydown(key('End',apps[0])); assert.equal(env.focused(),apps[10]);
  document.listeners.keydown(key('Escape',apps[10])); assert(!menu.open); assert.equal(env.focused(),summary);
  menu.open=true; document.listeners.click({target:summary}); assert(menu.open);
  document.listeners.click({target:{}}); assert(!menu.open);
  menu.open=true; menu.listeners.focusout({relatedTarget:apps[0]}); assert(menu.open);
  menu.listeners.focusout({relatedTarget:{}}); assert(!menu.open);
});

test('keyboard rearrangement saves order and navigation follows the reordered icons', () => {
  const env=launcher();
  const {apps,grid,panel,summary,status}=env;
  panel.listeners.keydown(key('ArrowUp',apps[10],{altKey:true}));
  assert.equal(grid.children[7],apps[10]);
  assert.equal(env.focused(),apps[10]);
  assert.equal(JSON.parse(env.stored())[7],'/app-10');
  assert.equal(status.textContent,'App 10 moved to position 8 of 11.');
  panel.listeners.keydown(key('ArrowRight',apps[10]));
  assert.equal(env.focused(),apps[7]);
  panel.listeners.keydown(key('Home',apps[10]));
  panel.listeners.keydown(key('ArrowLeft',apps[0],{altKey:true}));
  assert.equal(grid.children[0],apps[0]);
  panel.listeners.keydown(key('ArrowLeft',apps[10],{altKey:true}));
  const restored=launcher(env.stored());
  assert.deepEqual(restored.grid.children.map(app=>app.attrs.href),JSON.parse(env.stored()));
  summary.listeners.keydown(key('ArrowDown',summary));
  assert.equal(env.focused(),grid.children[0]);
});

test('saved order ignores duplicate or unknown apps and retains newly added apps', () => {
  const env=launcher(JSON.stringify(['/app-10','/app-10','https://example.org/','/app-2',null,{}]));
  assert.deepEqual(env.grid.children.map(app=>app.attrs.href),['/app-10','/app-2','/app-0','/app-1','/app-3','/app-4','/app-5','/app-6','/app-7','/app-8','/app-9']);
  assert.equal(launcher('{broken').grid.children.length,11);
  assert.equal(launcher('{"apps":[]}').grid.children.length,11);
  env.window.listeners.storage({key:'gregle-app-order',newValue:'["/app-9"]'});
  assert.equal(env.grid.children[0],env.apps[9]);
});

test('Docs and Cloud keep independent positions with the same destination and legacy saved order', () => {
  const env=launcher(JSON.stringify(['/app-9','/app-2']),true);
  assert.equal(env.grid.children[0],env.apps[9]);
  assert.equal(env.grid.children.at(-1),env.apps[10]);
  env.panel.listeners.keydown(key('ArrowUp',env.apps[10],{altKey:true}));
  const saved=JSON.parse(env.stored());
  assert.equal(saved.filter(id=>id==='/app-9').length,1);
  assert.equal(saved.filter(id=>id==='docs').length,1);
  const restored=launcher(env.stored(),true);
  assert.deepEqual(restored.grid.children.map(app=>app.attrs['data-gregle-app-id']||app.attrs.href),saved);
});
