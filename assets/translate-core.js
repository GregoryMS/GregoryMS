/* Pure helpers for the browser-only MyMemory translator. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GregleTranslate=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const encoder=new TextEncoder();
  const languages=[['ar','Arabic'],['bg','Bulgarian'],['ca','Catalan'],['zh-CN','Chinese (Simplified)'],['zh-TW','Chinese (Traditional)'],['hr','Croatian'],['cs','Czech'],['da','Danish'],['nl','Dutch'],['en','English'],['et','Estonian'],['fi','Finnish'],['fr','French'],['de','German'],['el','Greek'],['he','Hebrew'],['hi','Hindi'],['hu','Hungarian'],['id','Indonesian'],['it','Italian'],['ja','Japanese'],['ko','Korean'],['lv','Latvian'],['lt','Lithuanian'],['ms','Malay'],['no','Norwegian'],['fa','Persian'],['pl','Polish'],['pt','Portuguese'],['ro','Romanian'],['ru','Russian'],['sk','Slovak'],['sl','Slovenian'],['es','Spanish'],['sw','Swahili'],['sv','Swedish'],['th','Thai'],['tr','Turkish'],['uk','Ukrainian'],['vi','Vietnamese'],['cy','Welsh']];
  function splitText(value,maxBytes=500){
    if(!Number.isInteger(maxBytes)||maxBytes<4)throw Error('Invalid segment size.');
    const text=String(value),parts=[];let offset=0;
    while(offset<text.length){
      let bytes=0,end=offset;
      for(const char of text.slice(offset)){const size=encoder.encode(char).length;if(bytes+size>maxBytes)break;bytes+=size;end+=char.length;}
      if(end<text.length){let boundary=0;for(const m of text.slice(offset,end).matchAll(/[\s.!?。！？]/gu)){const candidate=offset+m.index+m[0].length;if(candidate-offset>=(end-offset)/2)boundary=candidate;}if(boundary)end=boundary;}
      parts.push(text.slice(offset,end));offset=end;
    }
    return parts;
  }
  function plan(text){return splitText(text).map(part=>{const [,prefix,body,suffix]=part.match(/^(\s*)([\s\S]*?)(\s*)$/u);return {prefix,body,suffix};});}
  function requestURL(text,from,to){
    const valid=new Set(languages.map(([code])=>code));
    if(!valid.has(from)||!valid.has(to))throw Error('Choose a supported language pair.');
    if(encoder.encode(text).length>500)throw Error('Translation request is too large.');
    const u=new URL('https://api.mymemory.translated.net/get');u.searchParams.set('q',text);u.searchParams.set('langpair',from+'|'+to);return u.href;
  }
  function decodeEntities(text){
    const map={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,key)=>{
      if(key[0]!=='#')return map[key.toLowerCase()]||whole;
      const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
      return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;
    });
  }
  function result(data){
    if(data?.quotaFinished||Number(data?.responseStatus)===429){const e=Error('MyMemory’s free daily allowance has been reached. Try again tomorrow, or use one of the translation links above.');e.code='quota';throw e;}
    if(Number(data?.responseStatus)!==200)throw Error(String(data?.responseDetails||'This language pair could not be translated. Try another language or service.'));
    const value=data?.responseData?.translatedText;
    if(typeof value!=='string'||!value.trim()||/MYMEMORY WARNING|QUERY LENGTH LIMIT EXCEEDED|INVALID LANGUAGE PAIR/i.test(value))throw Error('MyMemory could not translate this text. Try another language or service.');
    return decodeEntities(value);
  }
  function microsoftURL(text,from,to){
    const map={'no':'nb','zh-CN':'zh-Hans','zh-TW':'zh-Hant'};
    const u=new URL('https://www.bing.com/translator');u.searchParams.set('from',map[from]||from);u.searchParams.set('to',map[to]||to);
    // Avoid silently truncating drafts beyond the embedded translator's limit.
    if(text&&text.length<=1000)u.searchParams.set('text',text);
    return u.href;
  }
  return {languages,splitText,plan,requestURL,result,decodeEntities,microsoftURL};
});
