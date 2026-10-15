const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/translate-core.js');

test('UTF-8 chunking preserves text, whitespace and Unicode without exceeding the API byte limit',()=>{
  for(const text of ['word '.repeat(1000),'日本語の文章です。'.repeat(300),'🙂🧑🏽‍💻 café\n\n'.repeat(250),'x'.repeat(5001),'\n'.repeat(1200),'  Hello.\n\nGoodbye.  ','']){
    const chunks=core.splitText(text);
    assert.equal(chunks.join(''),text);
    for(const chunk of chunks){assert(Buffer.byteLength(chunk,'utf8')<=500);assert(!/[\ud800-\udbff]$/.test(chunk));}
    assert.equal(core.plan(text).map(p=>p.prefix+p.body+p.suffix).join(''),text);
  }
});
test('request URL encodes punctuation safely and rejects invalid languages and oversized text',()=>{
  const text='Hello & café? #one / two';const u=new URL(core.requestURL(text,'en','fr'));
  assert.equal(u.origin,'https://api.mymemory.translated.net');assert.equal(u.searchParams.get('q'),text);assert.equal(u.searchParams.get('langpair'),'en|fr');
  assert.throws(()=>core.requestURL('hello','auto','fr'));assert.throws(()=>core.requestURL('日'.repeat(167),'en','fr'));
});
test('quota and service errors cannot appear as successful translated text',()=>{
  const success={responseStatus:200,responseData:{translatedText:'Bonjour &amp; bienvenue &#x1f642;'}};
  assert.equal(core.result(success),'Bonjour & bienvenue 🙂');
  assert.throws(()=>core.result({...success,quotaFinished:true}),e=>e.code==='quota');
  assert.throws(()=>core.result({responseStatus:403,responseDetails:'Unsupported pair'}),/Unsupported pair/);
  assert.throws(()=>core.result({responseStatus:200,responseData:{translatedText:'MYMEMORY WARNING: quota exceeded'}}));
  assert.throws(()=>core.result({responseStatus:200,responseData:{translatedText:''}}));
});
test('Microsoft handoff keeps language choices and safely encodes short drafts without truncating long ones',()=>{
  const text='Hello & goodbye? #one';const u=new URL(core.microsoftURL(text,'no','zh-CN'));
  assert.equal(u.origin,'https://www.bing.com');assert.equal(u.searchParams.get('text'),text);assert.equal(u.searchParams.get('from'),'nb');assert.equal(u.searchParams.get('to'),'zh-Hans');
  assert.equal(new URL(core.microsoftURL('x'.repeat(1000),'en','fr')).searchParams.get('text').length,1000);
  assert.equal(new URL(core.microsoftURL('x'.repeat(1001),'en','fr')).searchParams.has('text'),false);
});

function page(fetch){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../translate.html'),'utf8'),elements=new Map();
  function element(){return {value:'',textContent:'',hidden:false,disabled:false,src:'',listeners:{},append(){},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(k,fn){this.listeners[k]=fn;},focus(){},select(){}};}
  for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,element());
  const get=id=>{assert(elements.has(id),'Missing HTML element '+id);return elements.get(id);};
  const context={window:{GregleTranslate:core},document:{getElementById:get,createElement:element},localStorage:{getItem(){return null;},setItem(){}},navigator:{},fetch,AbortController,setTimeout,clearTimeout,Map,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/translate.js'),'utf8'),context);
  const fire=(id,type)=>get(id).listeners[type]({preventDefault(){},target:get(id)});
  return {get,fire};
}
test('quota errors reveal a one-click Microsoft fallback without losing the draft',async()=>{
  const env=page(async()=>({ok:true,status:200,json:async()=>({responseStatus:200,quotaFinished:true})}));
  env.get('sourceText').value='Hello world';await env.fire('translationForm','submit');
  assert.equal(env.get('quotaFallback').hidden,false);assert.match(env.get('translationStatus').textContent,/allowance/);
  env.fire('useMicrosoft','click');
  assert.equal(env.get('translationForm').hidden,true);assert.equal(env.get('microsoftWorkspace').hidden,false);
  assert.equal(new URL(env.get('translatorFrame').src).searchParams.get('text'),'Hello world');
  env.fire('returnMyMemory','click');
  assert.equal(env.get('sourceText').value,'Hello world');assert.equal(env.get('sourceLanguage').value,'en');assert.equal(env.get('targetLanguage').value,'fr');assert.equal(env.get('translationForm').hidden,false);
});
test('switching provider during a request prevents a late MyMemory response from changing the page',async()=>{
  let finish;const env=page(()=>new Promise(resolve=>{finish=resolve;}));env.get('sourceText').value='Hello';
  const pending=env.fire('translationForm','submit');env.get('providerSelect').value='microsoft';env.fire('providerSelect','change');
  finish({ok:true,status:200,json:async()=>({responseStatus:200,responseData:{translatedText:'Late result'}})});await pending;
  assert.equal(env.get('translatedText').value,'');assert.equal(env.get('microsoftWorkspace').hidden,false);assert.equal(env.get('sourceText').value,'Hello');assert.equal(env.get('translateButton').disabled,false);
});
test('large drafts stay intact and are never silently truncated into the embedded translator',()=>{
  const env=page(()=>{throw Error('Unexpected MyMemory request');});const draft='日'.repeat(1500);env.get('sourceText').value=draft;
  env.get('providerSelect').value='microsoft';env.fire('providerSelect','change');
  assert.equal(new URL(env.get('translatorFrame').src).searchParams.has('text'),false);
  assert.match(env.get('microsoftNotice').textContent,/longer/);assert.equal(env.get('copyOriginal').hidden,false);assert.equal(env.get('sourceText').value,draft);
});
