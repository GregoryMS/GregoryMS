(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.GregleBillSplitter=factory();
})(typeof window==='object' ? window : globalThis,function(){
  'use strict';
  const MAX=100000000;
  function decimal(value,places,max,label) {
    const text=String(value ?? '').trim();
    if (!text) return 0;
    const pattern=new RegExp('^(?:[0-9]+(?:\\.[0-9]{0,'+places+'})?|\\.[0-9]{1,'+places+'})$');
    if(!pattern.test(text)) throw Error(label+' must be a non-negative number with at most '+places+' decimal places.');
    const [whole='0',fraction='']=text.split('.');
    const scaled=Number(whole || '0')*10**places+Number(fraction.padEnd(places,'0'));
    if(!Number.isSafeInteger(scaled) || scaled>max) throw Error(label+' is too large.');
    return scaled;
  }
  const money=value=>decimal(value,2,MAX,'Amount');
  const percent=value=>decimal(value,3,100000,'Percentage');
  function allocate(total,weights) {
    if(!Number.isSafeInteger(total) || total<0 || !weights.length || weights.some(n=>!Number.isSafeInteger(n)||n<0)) throw Error('Invalid shares.');
    const sum=weights.reduce((a,b)=>a+b,0);
    const effective=sum ? weights : weights.map(()=>1), divisor=BigInt(sum || weights.length);
    const parts=effective.map((w,i)=>{const product=BigInt(total)*BigInt(w);return {i,amount:Number(product/divisor),remainder:product%divisor};});
    let remaining=total-parts.reduce((n,p)=>n+p.amount,0);
    const order=[...parts].sort((a,b)=>a.remainder===b.remainder ? a.i-b.i : a.remainder>b.remainder ? -1 : 1);
    for(let i=0;i<remaining;i++) parts[order[i].i].amount++;
    return parts.map(p=>p.amount);
  }
  function extra(value,mode,base) {
    if(mode==='amount') return money(value);
    if(mode!=='percent') throw Error('Choose percentage or amount.');
    return Number((BigInt(base)*BigInt(percent(value))+50000n)/100000n);
  }
  function cappedAllocate(total,weights,caps) {
    const parts=allocate(total,weights).map((n,i)=>Math.min(n,caps[i]));
    let left=total-parts.reduce((a,b)=>a+b,0);
    while(left) {
      const available=weights.map((weight,i)=>caps[i]>parts[i] ? weight : 0);
      const active=weights.map((_,i)=>i).filter(i=>caps[i]>parts[i]);
      if(!active.length) throw Error('Unable to balance rounding.');
      const shares=allocate(left,active.map(i=>available[i]));
      for(let j=0;j<active.length;j++) {
        const i=active[j],added=Math.min(shares[j],caps[i]-parts[i]);
        parts[i]+=added;left-=added;
      }
    }
    return parts;
  }
  function calculate(input) {
    if(!Array.isArray(input.people) || input.people.length<1 || input.people.length>20) throw Error('Choose between 1 and 20 people.');
    if(!['equal','individual'].includes(input.mode)) throw Error('Choose how to split the bill.');
    const shared=money(input.subtotal), base=allocate(shared,input.people.map(()=>1));
    const subtotals=base.map((n,i)=>n+(input.mode==='individual' ? money(input.people[i].amount) : 0));
    const subtotal=subtotals.reduce((a,b)=>a+b,0);
    const tax=extra(input.tax,input.taxMode,subtotal);
    const tip=extra(input.tip,input.tipMode,subtotal+(input.afterTax ? tax : 0));
    const total=subtotal+tax+tip;
    const totals=allocate(total,input.mode==='equal' ? input.people.map(()=>1) : subtotals);
    const taxes=cappedAllocate(tax,subtotals,totals.map((n,i)=>n-subtotals[i]));
    const tips=totals.map((n,i)=>n-subtotals[i]-taxes[i]);
    return {subtotal,tax,tip,total:subtotal+tax+tip,
      people:input.people.map((person,i)=>({name:String(person.name || '').trim() || 'Person '+(i+1),
        subtotal:subtotals[i],tax:taxes[i],tip:tips[i],total:totals[i]}))};
  }
  return {money,percent,allocate,calculate};
});
