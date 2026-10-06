(() => {
  'use strict';
  const C=window.GregleBillSplitter, $=id=>document.getElementById(id);
  let people=[],nextId=0,result=null,announcementTimer;
  const mode=()=>document.querySelector('input[name="split-mode"]:checked').value;
  const currency=()=>$('split-currency').value;
  const format=amount=>new Intl.NumberFormat('en-CA',{style:'currency',currency:currency()}).format(amount/100);
  function element(tag,text,className) {
    const node=document.createElement(tag);
    if(text!==undefined) node.textContent=text;
    if(className) node.className=className;
    return node;
  }
  function addPerson(focus=false) {
    if(people.length>=20) return;
    const id=++nextId,row=element('div',undefined,'person-row');
    const nameLabel=element('label'),nameTitle=element('span'),name=element('input');
    name.type='text';name.maxLength=40;name.autocomplete='off';name.id='person-name-'+id;
    nameLabel.htmlFor=name.id;nameLabel.append(nameTitle,name);
    const amountLabel=element('label'),amountTitle=element('span','Individual subtotal'),amount=element('input');
    amount.type='text';amount.inputMode='decimal';amount.placeholder='0.00';amount.maxLength=12;amount.id='person-amount-'+id;
    amountLabel.htmlFor=amount.id;amountLabel.append(amountTitle,amount);
    const remove=element('button','×','pill remove-person');remove.type='button';
    const person={row,name,nameTitle,amount,amountLabel,remove};
    remove.addEventListener('click',()=>{
      const index=people.indexOf(person); people.splice(index,1);row.remove();updatePeople();calculate();
      (people[Math.min(index,people.length-1)]?.name || $('add-person')).focus();
    });
    row.append(nameLabel,amountLabel,remove);$('split-people').append(row);people.push(person);
    updatePeople();calculate();
    if(focus) name.focus();
  }
  function updatePeople() {
    const individual=mode()==='individual';
    people.forEach((person,index)=>{
      person.nameTitle.textContent='Person '+(index+1);
      person.name.placeholder='Name (optional)';
      person.row.classList.toggle('equal',!individual);person.amountLabel.hidden=!individual;
      person.remove.disabled=people.length===1;
      person.remove.setAttribute('aria-label','Remove person '+(index+1));
    });
    $('add-person').disabled=people.length>=20;
    $('subtotal-label').textContent=individual ? 'Shared items subtotal' : 'Bill subtotal';
    $('subtotal-help').textContent=individual ? 'Shared items only. Add each person’s own costs below.' : 'Before tax and tip. This amount is split equally.';
    $('people-help').textContent=individual ? 'Enter each person’s own costs, excluding shared items, tax and tip.' : 'Add names if you like. Everyone pays an equal share.';
    $('tip-after-tax').disabled=$('tip-mode').value==='amount';
  }
  function read(input,parser,label,errors) {
    try { parser(input.value);input.removeAttribute('aria-invalid'); }
    catch(error) {input.setAttribute('aria-invalid','true');errors.push(label+': '+error.message);}
    return input.value;
  }
  function calculate() {
    if(!people.length) return;
    result=null; $('copy-status').textContent='';
    const errors=[],individual=mode()==='individual';
    const subtotal=read($('split-subtotal'),C.money,'Subtotal',errors);
    const tax=read($('split-tax'),$('tax-mode').value==='percent' ? C.percent : C.money,'Tax',errors);
    const tip=read($('split-tip'),$('tip-mode').value==='percent' ? C.percent : C.money,'Tip',errors);
    const inputs=people.map((p,i)=>{
      if(!individual) p.amount.removeAttribute('aria-invalid');
      return {name:p.name.value,amount:individual ? read(p.amount,C.money,'Person '+(i+1),errors) : '0'};
    });
    if(!errors.length) {
      try {result=C.calculate({mode:mode(),subtotal,tax,tip,taxMode:$('tax-mode').value,tipMode:$('tip-mode').value,
        afterTax:$('tip-after-tax').checked,people:inputs});}
      catch(error) {errors.push(error.message);}
    }
    $('split-error').hidden=!errors.length;$('split-error').textContent=errors[0] || '';
    $('split-total').textContent=result ? format(result.total) : '—';
    for(const field of ['subtotal','tax','tip']) $('result-'+field).textContent=result ? format(result[field]) : '—';
    $('result-count').textContent=people.length;
    $('copy-split').disabled=!result || result.total===0;
    $('currency-note').textContent='All amounts are in '+currency()+'. Changing currency changes the label, without converting amounts.';
    document.querySelectorAll('[data-tip]').forEach(button=>{
      button.setAttribute('aria-pressed',String($('tip-mode').value==='percent' && Number($('split-tip').value)===Number(button.dataset.tip)));
    });
    const rows=(result?.people || []).map(person=>{
      const row=element('div',undefined,'share-row'),details=element('div');
      details.append(element('strong',person.name),element('p','Subtotal '+format(person.subtotal)+' · tax '+format(person.tax)+' · tip '+format(person.tip),'split-note'));
      const total=element('output',format(person.total));total.setAttribute('aria-label',person.name+' owes '+format(person.total));
      row.append(details,total);return row;
    });
    $('split-shares').replaceChildren(...rows);
    if(!result) $('split-shares').append(element('p','Fix the highlighted amount to see everyone’s share.','split-note'));
    clearTimeout(announcementTimer);
    announcementTimer=setTimeout(()=>{$('split-announcement').textContent=result ? 'Total '+format(result.total)+' split between '+people.length+' people.' : 'Please check your amounts.';},400);
  }
  function reset() {
    $('split-form').reset();$('split-people').replaceChildren();people=[];nextId=0;
    addPerson();addPerson();updatePeople();calculate();
  }
  $('split-form').addEventListener('submit',event=>event.preventDefault());
  $('split-form').addEventListener('input',()=>{updatePeople();calculate();});
  $('split-form').addEventListener('change',()=>{updatePeople();calculate();});
  $('add-person').addEventListener('click',()=>addPerson(true));
  $('split-reset').addEventListener('click',()=>{reset();$('split-subtotal').focus();});
  document.querySelectorAll('[data-tip]').forEach(button=>button.addEventListener('click',()=>{
    $('tip-mode').value='percent';$('split-tip').value=button.dataset.tip;updatePeople();calculate();
  }));
  $('copy-split').addEventListener('click',async()=>{
    if(!result) return;
    const text=['Bill split ('+currency()+')','Subtotal: '+format(result.subtotal),'Tax: '+format(result.tax),
      'Tip: '+format(result.tip),'Total: '+format(result.total),'',
      ...result.people.map(person=>person.name+': '+format(person.total)+' (subtotal '+format(person.subtotal)+', tax '+format(person.tax)+', tip '+format(person.tip)+')')].join('\n');
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea=element('textarea');textarea.value=text;textarea.className='sr-only';
        document.body.append(textarea);textarea.select();
        const copied=document.execCommand('copy');textarea.remove();$('copy-split').focus();
        if(!copied) throw Error('Clipboard unavailable');
      }
      $('copy-status').textContent='Breakdown copied.';
    } catch(_) {$('copy-status').textContent='Copy unavailable in this browser. You can select the breakdown text below.';}
  });
  reset();
})();
