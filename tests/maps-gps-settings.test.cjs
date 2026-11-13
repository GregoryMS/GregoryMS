const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('car settings GPS Debug toggles diagnostics and stops GPS on close, leaving car mode and page exit',()=>{
 let vehicle=true,observer,success;const created=[],cleared=[],events={};
 class Element{
  constructor(){this.children=new Map();this.events={};this.attrs={};this.style={};this.hidden=false;this.textContent='';}
  querySelector(id){if(!this.children.has(id)){const el=new Element();if(id==='#gps-debug-toggle')el.attrs['aria-checked']='false';this.children.set(id,el);}return this.children.get(id);}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}addEventListener(n,f){this.events[n]=f;}
  contains(node){return node===this;}focus(){}click(){this.events.click();}
 }
 const body={classList:{contains:()=>vehicle},append(){}},car={parentNode:{},after(){}};
 const document={body,createElement(){const el=new Element();created.push(el);return el;},getElementById:()=>car,addEventListener(){}};
 const window={isSecureContext:true,addEventListener:(n,f)=>events[n]=f};
 const navigator={geolocation:{watchPosition(s){success=s;return 0;},clearWatch:id=>cleared.push(id)}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-gps-test.js'),'utf8'),{document,window,navigator,MutationObserver:class{constructor(f){observer=f;}observe(){}},Date});
 const [settings,panel]=created,toggle=settings.querySelector('#gps-debug-toggle'),close=panel.querySelector('#gregle-gps-close');
 assert.equal(settings.hidden,false);assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(panel.hidden,true);
 toggle.click();assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-checked'),'true');
 close.click();assert.deepEqual(cleared,[0]);assert.equal(panel.hidden,true);assert.equal(toggle.getAttribute('aria-checked'),'false');
 success({coords:{}});assert.equal(panel.querySelector('#gregle-gps-state').textContent,'Stopped');
 toggle.click();vehicle=false;observer();assert.equal(settings.hidden,true);assert.equal(panel.hidden,true);assert.equal(cleared.length,2);
 vehicle=true;observer();toggle.click();events.pagehide();assert.equal(panel.hidden,true);assert.equal(cleared.length,3);
});
