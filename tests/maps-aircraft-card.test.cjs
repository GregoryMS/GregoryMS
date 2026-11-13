const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const events={},nodes=new Map();let closed=0,resize,width=1000,height=700;
 const el=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,style:{},scrollTop:0,events:{},addEventListener(n,fn){this.events[n]=fn;},replaceChildren(node){this.content=node;},setPointerCapture(){},getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:290,height:350};}});return nodes.get(id);};
 const stage={getBoundingClientRect:()=>({left:0,top:0,width,height}),querySelector:()=>({getBoundingClientRect:()=>({left:930,width:52})})};
 const window={addEventListener(){}},document={getElementById:el,querySelector:()=>stage};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-aircraft-card.js'),'utf8'),{window,document,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}}});
 const api=window.GregleAircraftCard({onClose(){closed++;}}),card=el('aircraft-info-card'),handle=el('aircraft-info-drag');
 const pointer=(x,y)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
 return {api,card,handle,el,closed:()=>closed,pointer,resize:(w,h)=>{width=w;height=h;resize();}};
}
test('aircraft card opens beside the controls, retains dragged position on refresh and clamps after resize',()=>{
 const h=setup();h.api.show({id:'first'});assert.equal(h.card.hidden,false);assert.equal(h.card.style.left,'628px');assert.equal(h.card.style.top,'290px');
 h.handle.events.pointerdown(h.pointer(630,290));h.handle.events.pointermove(h.pointer(300,100));h.handle.events.pointerup();
 const left=h.card.style.left,top=h.card.style.top;h.api.show({id:'updated'});assert.equal(h.card.style.left,left);assert.equal(h.card.style.top,top);
 h.resize(330,400);assert(+h.card.style.left.slice(0,-2)<=32);assert(+h.card.style.top.slice(0,-2)<=42);
 h.api.hide();assert.equal(h.card.hidden,true);
});
test('aircraft card supports keyboard movement, resetting its dock and closing with Escape',()=>{
 const h=setup();h.api.show({});const key=key=>({key,preventDefault(){},stopPropagation(){}});
 h.handle.events.keydown(key('ArrowLeft'));assert.equal(h.card.style.left,'608px');
 h.handle.events.keydown(key('Home'));assert.equal(h.card.style.left,'628px');
 h.card.events.keydown(key('Escape'));assert.equal(h.card.hidden,true);assert.equal(h.closed(),1);
});
