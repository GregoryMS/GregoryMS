((root,factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GregleParking=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const source='https://maps.victoria.ca/server/rest/services/OpenData/OpenData_Parking/MapServer';
 const zones={1:{colour:'#92cfea',rate:4,limit:'90 min',sundayRate:2.5,sundayLimit:'4 hrs'},2:{colour:'#5baea4',rate:3,limit:'4 hrs',sundayRate:1.5,sundayLimit:'4 hrs'},3:{colour:'#cb6278',rate:3,limit:'2 hrs',sundayRate:1.5,sundayLimit:'4 hrs'},4:{colour:'#342d8e',rate:2.5,limit:'4 hrs',sundayRate:1.5,sundayLimit:'4 hrs'},5:{colour:'#d8c96b',rate:2,limit:'24 hrs',sundayRate:1.5,sundayLimit:'24 hrs'}};
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>-123.5&&p[0]<-123.2&&p[1]>48.35&&p[1]<48.5;
 function read(data){
  if(data?.version!==1||data.source!==source||!/^\d{4}-\d{2}-\d{2}$/.test(data.checked)||!Array.isArray(data.spaces)||data.spaces.length>4000||!Array.isArray(data.facilities)||data.facilities.length>30)throw Error('Invalid parking snapshot');
  const ids=new Set();
  for(const s of data.spaces){if(!Number.isSafeInteger(s.id)||ids.has(s.id)||!point(s.point)||!Object.hasOwn(zones,s.zone)||typeof s.meter!=='string'||s.meter.length>40)throw Error('Invalid parking space');ids.add(s.id);}
  for(const f of data.facilities)if(!point(f.point)||!['parkade','lot'].includes(f.kind)||typeof f.name!=='string'||f.name.length>120)throw Error('Invalid parking facility');
  return data;
 }
 return {zones,read};
});
