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
