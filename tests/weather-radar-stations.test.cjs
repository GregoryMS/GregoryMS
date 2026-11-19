const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../assets/weather-radar-stations.js');
function setup() {
  const created=[],chosen=[],layers=new Set();
  const env={document:{createElement:()=>({textContent:''})},L:{
    divIcon:options=>options,
    marker(coords,options){
      const attrs={},classes=new Set(),events={},keys={};
      const node={classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},setAttribute(k,v){attrs[k]=v;},addEventListener(k,fn){keys[k]=fn;}};
      const marker={coords,options,attrs,classes,events,keys,getElement:()=>node,
        bindTooltip(label){this.label=label.textContent;return this;},on(k,fn){events[k]=fn;return this;}};
      created.push(marker);return marker;
    },
    layerGroup(){return {children:[],addLayer(m){this.children.push(m);if(layers.has(this))m.events.add();},
      clearLayers(){this.children=[];},addTo(){layers.add(this);for(const m of this.children)m.events.add();return this;}};}
  }};
  const map={getPane:()=>null,createPane:()=>({style:{}}),hasLayer:g=>layers.has(g),removeLayer:g=>layers.delete(g)};
  const sites=[{id:'KATX',name:'Camano Island',lat:48.19461,lon:-122.49569},{id:'KLGX',name:'Langley Hill',lat:47.116,lon:-124.106}];
  const overlay=create(env);overlay.setSites(sites);overlay.attach(map,id=>chosen.push(id));overlay.setVisible(true);
  return {overlay,created,chosen,layers,sites};
}
test('station markers select their station by click or Space and have accessible names',()=>{
  const h=setup(),[atx,lgx]=h.created;
  assert.match(atx.attrs['aria-label'],/KATX.*Camano Island/);
  atx.events.click();assert.deepEqual(h.chosen,['KATX']);
  let prevented=false;lgx.keys.keydown({key:' ',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(h.chosen,['KATX','KLGX']);
});
test('dropdown selection highlights only the selected station and survives hide/show',()=>{
  const h=setup(),[atx,lgx]=h.created;
  h.overlay.select('KATX');assert.equal(atx.attrs['aria-pressed'],'true');
  h.overlay.select('KLGX');assert.equal(atx.attrs['aria-pressed'],'false');assert.equal(lgx.attrs['aria-pressed'],'true');
  h.overlay.setVisible(false);assert.equal(h.layers.size,0);
  h.overlay.setVisible(true);assert.equal(h.layers.size,1);assert.equal(lgx.attrs['aria-pressed'],'true');
  assert.equal(h.created.length,2,'visibility changes reuse the markers');
  assert.deepEqual(h.chosen,[],'hiding stations does not change the radar source');
});
test('mosaic clears the selected dot, and refreshing station data does not duplicate markers',()=>{
  const h=setup();h.overlay.select('KATX');h.overlay.select('');
  assert.equal(h.created[0].attrs['aria-pressed'],'false');
  h.overlay.setSites(h.sites);assert.equal([...h.layers][0].children.length,2);
});
