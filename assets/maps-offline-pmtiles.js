/* Local-only PMTiles source. Reads are serialized and retain at most two 4 MiB blocks. */
(() => {
  'use strict';
  const store=globalThis.GregleOfflineStore;
  globalThis.GregleOfflineArchive=pack=>{
    const cache=new Map();let chain=Promise.resolve();
    const source={getKey:()=>pack.generation||pack.key+':'+pack.version,getBytes(offset,length,signal){
      const read=chain.then(async()=>({data:await store.range(pack,offset,length,signal,cache)}));
      chain=read.catch(()=>{});return read;
    }};
    return new pmtiles.PMTiles(source,new pmtiles.SharedPromiseCache(32));
  };
})();
