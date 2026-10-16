(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const languages = {
    'en-GB': {name:'British English', sections:['English'], codes:['en'], voice:'en-GB', examples:['serendipity','colour','brilliant'], dictionary:['Oxford English','https://www.oxfordlearnersdictionaries.com/search/english/?q='], thesaurus:['Collins Thesaurus','https://www.collinsdictionary.com/dictionary/english-thesaurus/']},
    fr: {name:'French', sections:['French'], codes:['fr'], voice:'fr-FR', examples:['heureux','maison','lumière'], dictionary:['Larousse','https://www.larousse.fr/dictionnaires/francais/'], thesaurus:['CNRTL Synonyms','https://www.cnrtl.fr/synonymie/']},
    no: {name:'Norwegian', sections:['Norwegian Bokmål','Norwegian Nynorsk','Norwegian'], codes:['nb','nn','no'], voice:'nb-NO', examples:['glad','hyggelig','hus'], dictionary:['Ordbøkene','https://ordbokene.no/bm,nn/'], thesaurus:['Synonymordboka','https://www.synonymordboka.no/no/?q=']},
    de: {name:'German', sections:['German'], codes:['de'], voice:'de-DE', examples:['glücklich','Haus','schön'], dictionary:['DWDS','https://www.dwds.de/wb/'], thesaurus:['OpenThesaurus','https://www.openthesaurus.de/synonyme/']}
  };
  let language = 'en-GB', mode = 'dictionary', current = '', controller, serial = 0, entry;
  const cache = new Map();
  const clean = value => value.replace(/[\u200e\u200f]/g,'').replace(/\s+/g,' ').trim();
  function el(tag, text, cls) { const n=document.createElement(tag); if(text)n.textContent=text; if(cls)n.className=cls; return n; }
  function link(label, url, cls) { const a=el('a',label,cls); a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; return a; }
  function wordButton(word) { const b=el('button',word,'word-chip'); b.type='button'; b.addEventListener('click',()=>{$('word').value=word;search();}); return b; }
  function sourceLinks(word) {
    const lang=languages[language]; const box=$('sourceLinks'); box.replaceChildren();
    box.append(link(lang.dictionary[0]+' ↗',lang.dictionary[1]+encodeURIComponent(word),'reference preferred'));
    box.append(link(lang.thesaurus[0]+' ↗',lang.thesaurus[1]+encodeURIComponent(word),'reference'));
    box.append(link('Wiktionary ↗','https://en.wiktionary.org/wiki/'+encodeURIComponent(word)+'#'+lang.sections[0].replaceAll(' ','_'),'reference'));
  }
  function updateLanguage() {
    const lang=languages[language]; $('word').lang=lang.voice; $('languageNote').textContent=language==='en-GB'?'British spelling · UK pronunciation · Oxford reference':'Look up '+lang.name+' words · definitions in English';
    $('examples').replaceChildren(el('span','Try a word'));
    lang.examples.forEach(w=>$('examples').append(wordButton(w)));
    sourceLinks($('word').value.trim());
    try {localStorage.setItem('gregle-dictionary-language',language);}catch(_){}
  }
  async function json(url, signal) {
    const response=await fetch(url,{signal}); if(!response.ok)throw Error('service'); return response.json();
  }
  async function wiki(word, signal, domain='en') {
    const params=new URLSearchParams({action:'parse',page:word,prop:'text',format:'json',formatversion:'2',origin:'*',redirects:'1',disableeditsection:'1'});
    const data=await json('https://'+domain+'.wiktionary.org/w/api.php?'+params,signal);
    if(data.error) {if(data.error.code==='missingtitle')return null;throw Error('service');}
    return data.parse;
  }
  // MobileFrontend wraps each language in sections on iPhone responses.
  // Flatten only those structural containers, retaining heading/content order.
  function pageBlocks(root) {
    const blocks=[];
    function visit(parent) {
      for(const child of Array.from(parent.children)) {
        if(child.tagName.toUpperCase()==='SECTION')visit(child);
        else blocks.push(child);
      }
    }
    visit(root);
    return blocks;
  }
  // Read only the selected modern language. Never insert remote markup into the page.
  function parse(html, lang) {
    const doc=new DOMParser().parseFromString(html,'text/html');
    const root=doc.querySelector('.mw-parser-output')||doc.body;
    const result={groups:[],synonyms:[],antonyms:[],ipa:'',lemma:''};
    let active=false, section='', pos='', relation='', group;
    const parts=/^(Noun|Proper noun|Verb|Adjective|Adverb|Pronoun|Preposition|Conjunction|Interjection|Determiner|Article|Numeral|Particle|Phrase|Idiom|Proverb|Letter|Symbol|Prefix|Suffix)$/;
    function addTerms(node, target) {
      node.querySelectorAll('[lang] a, a[lang]').forEach(a=>{
        const code=a.closest('[lang]')?.getAttribute('lang');
        const text=clean(a.textContent);
        if(lang.codes.includes(code)&&a.closest('[lang]')!==root&&text&&text.length<80&&!text.includes(':'))target.push(text);
      });
    }
    for(const node of pageBlocks(root)) {
      const h=node.matches('h2,h3,h4,h5,h6')?node:node.matches('.mw-heading')?node.querySelector('h2,h3,h4,h5,h6'):null;
      if(h) {
        const title=clean(h.textContent.replace(/\[edit\]/g,''));
        if(h.tagName==='H2') {active=lang.sections.includes(title); section=title;pos='';group=null;relation='';continue;}
        if(!active)continue;
        relation=/^Synonyms/.test(title)?'synonyms':/^Antonyms/.test(title)?'antonyms':'';
        if(parts.test(title)){pos=title;group={pos,section,definitions:[]};result.groups.push(group);}else if(!relation){pos='';}
        continue;
      }
      if(!active)continue;
      if(relation)addTerms(node,result[relation]);
      node.querySelectorAll('.synonym').forEach(n=>addTerms(n,result.synonyms));
      node.querySelectorAll('.antonym').forEach(n=>addTerms(n,result.antonyms));
      if(!result.ipa) {
        const ipaNodes=[...node.querySelectorAll('.IPA')];
        const uk=ipaNodes.find(n=>/\b(UK|Britain|British|RP|Received Pronunciation)\b/.test(n.closest('li')?.textContent||''));
        if(ipaNodes.length)result.ipa=(language==='en-GB'?uk:ipaNodes[0])?.textContent||'';
      }
      if(pos&&group&&node.matches('ol')) {
        for(const li of Array.from(node.children).filter(child=>child.tagName.toUpperCase()==='LI')) {
          const copy=li.cloneNode(true);
          copy.querySelectorAll('style,script,link,template,ul,ol,dl,table,.citation,.HQToggle,.synonym,.antonym,.nyms-toggle,.mw-editsection,sup').forEach(n=>n.remove());
          const text=clean(copy.textContent).replace(/\[\s*quotations\s*▼?\s*\]/gi,'').trim();
          if(text)group.definitions.push(text);
          if(!result.lemma&&/standard spelling of|alternative (?:form|spelling) of/.test(text)) {
            const a=li.querySelector('.form-of-definition-link a')||li.querySelector('.form-of-definition [lang] a');
            if(a)result.lemma=clean(a.textContent);
          }
        }
      }
    }
    result.groups=result.groups.filter(g=>g.definitions.length);
    if(language==='en-GB')result.groups.forEach(g=>g.definitions.sort((a,b)=>Number(/\b(UK|British)\b/.test(b))-Number(/\b(UK|British)\b/.test(a))));
    const british={color:'colour',favor:'favour',honor:'honour',center:'centre',theater:'theatre',gray:'grey',colorful:'colourful',neighbor:'neighbour',behavior:'behaviour',marvelous:'marvellous',splendor:'splendour',humor:'humour',odor:'odour'};
    for(const key of ['synonyms','antonyms'])result[key]=[...new Set(result[key].map(w=>language==='en-GB'?(british[w]||w):w))].slice(0,60);
    return result;
  }
  function norwegianRelations(html) {
    const doc=new DOMParser().parseFromString(html,'text/html');
    const root=doc.querySelector('.mw-parser-output')||doc.body;
    const terms={synonyms:[],antonyms:[]};let active=false,relation='';
    for(const node of pageBlocks(root)) {
      const h=node.matches('h2,h3,h4,h5,h6')?node:node.matches('.mw-heading')?node.querySelector('h2,h3,h4,h5,h6'):null;
      if(h){const title=clean(h.textContent);if(h.tagName==='H2')active=/^Norsk(?: bokmål| nynorsk)?$/.test(title);relation=/^Synonymer$/.test(title)?'synonyms':/^Antonymer$/.test(title)?'antonyms':'';continue;}
      if(active&&relation)node.querySelectorAll('li a[href]').forEach(a=>{const text=clean(a.textContent),href=a.getAttribute('href');if(text&&text.length<80&&!text.includes(':')&&(href.startsWith('/wiki/')||href.startsWith('/w/index.php?title=')))terms[relation].push(text);});
    }
    return terms;
  }
  function setMode(next) {
    mode=next; document.querySelectorAll('[data-mode]').forEach(b=>{const selected=b.dataset.mode===mode;b.setAttribute('aria-pressed',String(selected));});
    if(entry)render();
  }
  function britishText(text) {
    // Keep spelling-reference targets exact, rather than making colour refer to itself.
    if(/standard spelling of|alternative (?:form|spelling) of/.test(text))return text;
    const forms={color:'colour',colors:'colours',colored:'coloured',coloring:'colouring',colorful:'colourful',colorless:'colourless',favor:'favour',favors:'favours',favored:'favoured',favorable:'favourable',gray:'grey',center:'centre',centers:'centres',centered:'centred',theater:'theatre',theaters:'theatres',honor:'honour',honors:'honours',honored:'honoured',neighbor:'neighbour',neighbors:'neighbours',behavior:'behaviour',behaviors:'behaviours',marvelous:'marvellous',humor:'humour',odor:'odour'};
    return text.replace(/\b[a-z]+\b/gi,w=>{const replacement=forms[w.toLowerCase()];return replacement?(w[0]===w[0].toUpperCase()?replacement[0].toUpperCase()+replacement.slice(1):replacement):w;});
  }
  function render() {
    const box=$('entryContent');box.replaceChildren();
    $('entryTitle').textContent=current; $('entryLanguage').textContent=languages[language].name;
    $('pronunciation').textContent=entry.ipa;
    $('speak').hidden=!('speechSynthesis' in window);
    if(mode==='dictionary') {
      if(!entry.groups.length)box.append(el('p','No definition was found for this word in '+languages[language].name+'. Check the spelling, including accents and capital letters, or use a reference above.','empty-message'));
      entry.groups.forEach(g=>{
        const section=el('section',null,'meaning-group');section.append(el('h3',g.pos+(language==='no'?' · '+g.section:'')));
        const list=el('ol');g.definitions.slice(0,20).forEach(d=>list.append(el('li',language==='en-GB'?britishText(d):d)));section.append(list);box.append(section);
      });
      if(entry.lemma&&entry.supplement?.groups.length){
        const section=el('section',null,'meaning-group');section.append(el('h3','Full entry · '+entry.lemma));
        section.append(el('p','Wiktionary links this spelling to the following entry.','entry-note'));
        entry.supplement.groups.forEach(g=>{section.append(el('h4',g.pos));const list=el('ol');g.definitions.slice(0,12).forEach(d=>list.append(el('li',language==='en-GB'?britishText(d):d)));section.append(list);});box.append(section);
      }
    } else {
      for(const key of ['synonyms','antonyms']) {
        const section=el('section',null,'meaning-group');section.append(el('h3',key==='synonyms'?'Synonyms':'Antonyms'));
        if(entry[key].length){const chips=el('div',null,'word-chips');entry[key].forEach(w=>chips.append(wordButton(w)));section.append(chips);}
        else section.append(el('p','No '+key+' were listed for this entry. Try the thesaurus reference above.','empty-message'));
        box.append(section);
      }
      box.append(el('p','Words can have several senses. Check a definition before choosing a synonym.','entry-note'));
    }
    $('sourceCredit').replaceChildren(document.createTextNode('Definitions and word relations adapted from '),link('Wiktionary','https://en.wiktionary.org/wiki/'+encodeURIComponent(current)),document.createTextNode(' · '),link('CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/'));
    if(entry.norwegian)$('sourceCredit').append(document.createTextNode(' · Norwegian word relations: '),link('Wiktionary (Norsk)','https://no.wiktionary.org/wiki/'+encodeURIComponent(current)));
    if(entry.supplement)$('sourceCredit').append(document.createTextNode(' · Full entry: '),link(entry.lemma,'https://en.wiktionary.org/wiki/'+encodeURIComponent(entry.lemma)));
    if(entry.datamuse)$('sourceCredit').append(document.createTextNode(' · Additional English word relations: '),link('Datamuse','https://www.datamuse.com/api/'));
  }
  async function search() {
    const word=clean($('word').value).slice(0,100);if(!word){$('word').focus();return;}
    $('word').value=word;current=word;controller?.abort();const request=++serial;
    controller=new AbortController();const signal=controller.signal;const timeout=setTimeout(()=>controller.abort(),16000);
    sourceLinks(word);$('entry').hidden=true;$('welcome').hidden=true;$('searchStatus').textContent='Looking up “'+word+'”…';$('results').setAttribute('aria-busy','true');entry=null;
    const state={q:word,lang:language,mode};const url=new URL(location.href);url.search=new URLSearchParams(state).toString();history.replaceState(null,'',url);
    try {
      const key=language+':'+word;let data=cache.get(key);
      if(!data) {
        const raw=await wiki(word,signal);data=raw?parse(raw.text,languages[language]):{groups:[],synonyms:[],antonyms:[],ipa:'',lemma:''};
        if(data.lemma&&data.lemma!==word){try{const lemma=await wiki(data.lemma,signal);if(lemma){data.supplement=parse(lemma.text,languages[language]);data.synonyms.push(...data.supplement.synonyms);data.antonyms.push(...data.supplement.antonyms);}}catch(e){if(signal.aborted)throw e;}}
        if(language==='no') {
          try {const native=await wiki(word,signal,'no');if(native){const terms=norwegianRelations(native.text);for(const key of ['synonyms','antonyms'])data[key]=[...new Set([...data[key],...terms[key]])].slice(0,60);data.norwegian=terms.synonyms.length+terms.antonyms.length>0;}}catch(e){if(signal.aborted)throw e;}
        }
        if(language==='en-GB'&&!data.synonyms.length&&data.groups.length) {
          try {
            const extra=await json('https://api.datamuse.com/words?'+new URLSearchParams({rel_syn:word,max:'30'}),signal);
            const british={color:'colour',favor:'favour',honor:'honour',center:'centre',theater:'theatre',gray:'grey',colorful:'colourful',neighbor:'neighbour',behavior:'behaviour'};
            data.synonyms=[...new Set(extra.map(w=>british[w.word]||w.word))];data.datamuse=extra.length>0;
          } catch(e){if(signal.aborted)throw e;}
        }
        if(data.groups.length)cache.set(key,data);
      }
      if(request!==serial)return;entry=data;render();$('entry').hidden=false;
      $('searchStatus').textContent=data.groups.length?'Entry found · '+languages[language].name:'No matching entry · '+languages[language].name;
    } catch(error) {
      if(request!==serial)return;
      $('searchStatus').textContent='The dictionary service is unavailable'+(signal.aborted?' or took too long':'')+'. Try again, or open a reference above.';
      $('welcome').hidden=false;
    } finally {clearTimeout(timeout);if(request===serial)$('results').setAttribute('aria-busy','false');}
  }
  $('lookupForm').addEventListener('submit',e=>{e.preventDefault();search();});
  $('language').addEventListener('change',()=>{language=$('language').value;updateLanguage();if($('word').value.trim())search();});
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{setMode(b.dataset.mode);if(current){const url=new URL(location.href);url.searchParams.set('mode',mode);history.replaceState(null,'',url);}}));
  $('speak').addEventListener('click',()=>{
    speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(current);utterance.lang=languages[language].voice;
    const voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()===utterance.lang.toLowerCase());if(voice)utterance.voice=voice;
    utterance.onerror=()=>{$('searchStatus').textContent='Pronunciation is unavailable on this device. Use the dictionary reference for audio.';};speechSynthesis.speak(utterance);
  });
  const params=new URLSearchParams(location.search);
  try{const saved=localStorage.getItem('gregle-dictionary-language');if(languages[saved])language=saved;}catch(_){}
  if(languages[params.get('lang')])language=params.get('lang');
  $('language').value=language;updateLanguage();
  if(params.get('mode')==='thesaurus')setMode('thesaurus');
  if(params.get('q')){$('word').value=params.get('q').slice(0,100);search();}
})();
