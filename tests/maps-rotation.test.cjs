const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-core.js');
test('shared map links retain valid bearing and reject malformed rotation',()=>{
 const view={lat:48.42,lng:-123.36,zoom:14,bearing:75};
 assert.equal(core.readHash(core.makeHash(view)).view.bearing,75);
 for(const bearing of ['oops','Infinity','-20','900'])assert.equal(core.readHash('#map=14/48.42/-123.36&bearing='+bearing).view.bearing,undefined);
 assert(!core.makeHash({...view,bearing:0}).includes('bearing='));
});
test('rotation buttons rotate left/right and compass returns north with a synchronised needle',()=>{
 let bearing=0,onRotate,changes=0;const buttons=[];
 const window={},L={control:()=>({addTo(){this.onAdd();}}),DomUtil:{create(tag){const el={style:{},setAttribute(){},querySelector:()=>({style:{}})};if(tag==='button')buttons.push(el);return el;}},DomEvent:{on(el,event,fn){el.click=()=>fn({});},stop(){},disableClickPropagation(){},disableScrollPropagation(){}}};
 const map={setBearing(v){bearing=(v+360)%360;onRotate();},getBearing:()=>bearing,on:(name,fn)=>onRotate=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-rotation.js'),'utf8'),{window,L});
 window.GregleMapRotation({map,onChange:()=>changes++});buttons[2].click();assert.equal(bearing,15);assert.match(buttons[1].title,/345°/);
 buttons[0].click();assert.equal(bearing,0);buttons[0].click();assert.equal(bearing,345);buttons[1].click();assert.equal(bearing,0);assert.equal(changes,5);
});
