(() => {
  'use strict';
  const core=window.GregleTranslate,$=id=>document.getElementById(id);
  const source=$('sourceText'),output=$('translatedText'),from=$('sourceLanguage'),to=$('targetLanguage'),status=$('translationStatus');
  let revision=0,controller=null,busy=false,complete=false,provider='mymemory';const cache=new Map();
  for(const [code,name]of core.languages){for(const select of [from,to]){const option=document.createElement('option');option.value=code;option.textContent=name;select.append(option);}}
  from.value='en';to.value='fr';
  try{const p=JSON.parse(localStorage.getItem('gregle-translate-languages')||'null');if(p&&core.languages.some(x=>x[0]===p.from)&&core.languages.some(x=>x[0]===p.to)){from.value=p.from;to.value=p.to;}}catch{}
  function update(){
    $('characterCount').textContent=source.value.length.toLocaleString()+' / 5,000';
    $('translateButton').disabled=busy||!source.value.trim();$('translateButton').textContent=busy?'Translating…':'Translate';
    $('cancelButton').hidden=!busy;$('copyButton').disabled=!complete;$('clearButton').disabled=!source.value&&!output.value;
    $('resultLabel').textContent=complete?'Translation ready':busy?'Translating…':'Your translation';
    output.setAttribute('aria-busy',String(busy));source.lang=from.value;output.lang=to.value;
  }
  function stopRequest(){revision++;controller?.abort();controller=null;busy=false;}
  function cancel(message=''){
    stopRequest();complete=false;output.value='';status.textContent=message;$('quotaFallback').hidden=true;update();
  }
  function switchProvider(next){
    if(!['mymemory','microsoft'].includes(next))return;
    const wasBusy=busy;stopRequest();if(wasBusy){complete=false;output.value='';status.textContent='MyMemory translation cancelled.';}
    provider=next;$('providerSelect').value=next;
    $('translationForm').hidden=next!=='mymemory';$('myMemoryHelp').hidden=next!=='mymemory';$('microsoftWorkspace').hidden=next!=='microsoft';
    $('providerSymbol').textContent=next==='microsoft'?'⊞':'↔';$('providerHint').textContent=next==='microsoft'?'Embedded translator':'Switch translator';
    if(next==='microsoft'){
      const url=core.microsoftURL(source.value,from.value,to.value);$('openMicrosoft').href=url;
      $('copyOriginal').hidden=!source.value;
      $('microsoftNotice').textContent=source.value.length>1000?'Your draft is longer than Microsoft’s text limit. Copy the original and translate it there in smaller sections.':source.value?'Your text and language choices have been sent to Microsoft.':'Choose your languages and enter text in the Microsoft panel below.';
      $('translatorFrame').src=url;
    }else{$('translatorFrame').removeAttribute('src');}
    try{localStorage.setItem('gregle-translate-provider',next);}catch{}update();
  }
  $('providerSelect').addEventListener('change',e=>switchProvider(e.target.value));
  $('useMicrosoft').addEventListener('click',()=>switchProvider('microsoft'));
  $('returnMyMemory').addEventListener('click',()=>switchProvider('mymemory'));
  $('copyOriginal').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(source.value);$('microsoftNotice').textContent='Original text copied. Paste it into Microsoft to continue.';}
    catch{switchProvider('mymemory');source.focus();source.select();status.textContent='Select Copy from your device’s menu, then switch to Microsoft.';}
  });
  function changed(){cancel(source.value.trim()?'Ready when you are. Press Translate.':'');}
  function preferences(){try{localStorage.setItem('gregle-translate-languages',JSON.stringify({from:from.value,to:to.value}));}catch{}}
  source.addEventListener('input',changed);
  for(const select of [from,to])select.addEventListener('change',()=>{changed();preferences();});
  $('clearButton').addEventListener('click',()=>{cancel();source.value='';cache.clear();update();source.focus();});
  $('cancelButton').addEventListener('click',()=>cancel('Translation cancelled.'));
  $('swapLanguages').addEventListener('click',()=>{const translated=complete?output.value:null;[from.value,to.value]=[to.value,from.value];if(translated!==null)source.value=translated;cancel();preferences();update();});
  $('copyButton').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(output.value);status.textContent='Translation copied.';}
    catch{output.focus();output.select();status.textContent='Select Copy from your device’s menu to copy the translation.';}
  });
  source.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!busy)$('translationForm').requestSubmit();}});
  $('translationForm').addEventListener('submit',async e=>{
    e.preventDefault();if(provider!=='mymemory'||busy||!source.value.trim())return;
    if(source.value.length>5000){status.textContent='Please translate up to 5,000 characters at a time.';return;}
    cancel();const mine=revision,text=source.value,fromCode=from.value,toCode=to.value;
    if(fromCode===toCode){output.value=text;complete=true;status.textContent='Both languages match, so your text is unchanged.';update();return;}
    const parts=core.plan(text);controller=new AbortController();const signal=controller.signal;busy=true;update();const translated=[];
    try{
      for(let i=0;i<parts.length;i++){
        if(mine!==revision)return;
        status.textContent='Translating… '+Math.round(i/parts.length*100)+'%';const part=parts[i];let value='';
        if(part.body){
          const key=fromCode+'|'+toCode+'|'+part.body;
          if(cache.has(key))value=cache.get(key);
          else{
            let timedOut=false;const requestController=new AbortController();const abort=()=>requestController.abort();signal.addEventListener('abort',abort,{once:true});
            const timer=setTimeout(()=>{timedOut=true;requestController.abort();},20000);
            try{
              const response=await fetch(core.requestURL(part.body,fromCode,toCode),{credentials:'omit',referrerPolicy:'no-referrer',signal:requestController.signal});
              if(response.status===429){const error=Error('MyMemory is temporarily limiting requests. Switch to Microsoft Translate to continue.');error.code='quota';throw error;}
              if(!response.ok)throw Error('MyMemory is unavailable right now. Try again later or use one of the links above.');
              value=core.result(await response.json());if(mine!==revision)return;
              cache.set(key,value);if(cache.size>100)cache.delete(cache.keys().next().value);
            }catch(error){if(timedOut)throw Error('MyMemory took too long to respond. Please try again.');throw error;}
            finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
          }
        }
        if(mine!==revision)return;translated.push(part.prefix+value+part.suffix);output.value=translated.join('');
      }
      complete=true;status.textContent='Translated with MyMemory.';
    }catch(error){
      if(mine!==revision)return;
      output.value='';complete=false;
      status.textContent=error.name==='TypeError'?'Could not reach MyMemory. Check your connection or use one of the links above.':error.message;
      $('quotaFallback').hidden=false;
    }finally{if(mine===revision){busy=false;controller=null;update();}}
  });
  let savedProvider;try{savedProvider=localStorage.getItem('gregle-translate-provider');}catch{}
  switchProvider(savedProvider==='microsoft'?'microsoft':'mymemory');
})();
