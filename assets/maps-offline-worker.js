'use strict';
importScripts('maps-navigation-core.js', 'maps-offline-store.js', 'maps-offline-routing.js');
let generation = 0;
self.onmessage = async event => {
  const {id,from,to,mode,cancel} = event.data;
  if(cancel){generation++;return;}
  const token=++generation,store=self.GregleOfflineStore;
  const check=()=>{if(token!==generation)throw new DOMException('Aborted','AbortError');};
  try {
    const installed=(await store.list()).filter(p=>p.component==='routing'&&store.inside(from,p.bounds)&&store.inside(to,p.bounds)).sort((a,b)=>a.blob.size-b.blob.size);
    if(!installed.length)throw Error('Download offline routing for a region containing both points first.');
    let result,error;
    for(const pack of installed){
      const cache=new Map(),keys=new Set(Object.keys(pack.index.entries));
      const load=async key=>{check();if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}const value=await store.read(pack,key);check();cache.set(key,value);while(cache.size>12)cache.delete(cache.keys().next().value);return value;};
      try{result=await self.GregleOfflineRouting.route(from,to,mode,{load,keys,tile:store.tile,inside:p=>store.inside(p,pack.bounds),check});break;}
      catch(e){check();error=e;}
    }
    check();if(!result)throw error;
    self.postMessage({id,result});
  } catch(error){if(token===generation)self.postMessage({id,error:error.message});}
};
