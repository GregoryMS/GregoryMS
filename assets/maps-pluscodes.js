((root,factory)=>{
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./openlocationcode.js'));
 else root.GreglePlusCodes=factory(root.OpenLocationCode);
})(typeof window==='object'?window:globalThis,olc=>{
 'use strict';
 function read(input){
  const parts=String(input).trim().split(/\s+/),code=parts.shift().toUpperCase();
  if(!olc.isFull(code)&&!olc.isShort(code))return null;
  return {code,locality:parts.join(' '),short:olc.isShort(code)};
 }
 function point(input,reference){
  const full=input.short?olc.recoverNearest(input.code,reference.lat,reference.lng):input.code;
  const area=olc.decode(full);
  return {lat:area.latitudeCenter,lng:area.longitudeCenter,name:full,zoom:18,
   detail:input.short?'Short Plus Code resolved near '+(input.locality||'the current map centre')+'.':'Open Location Code (Plus Code)'};
 }
 return {read,point,encode:(lat,lng)=>olc.encode(lat,lng,11)};
});
