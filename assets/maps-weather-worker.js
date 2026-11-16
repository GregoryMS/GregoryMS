/* Stream the compact GeoNames index without constructing a world-sized JS array. */
'use strict';
importScripts('weather-core.js','maps-weather-core.js','maps-offline-store.js');
let generation=0,index;
async function cityIndex(){
 if(!index)index=(async()=>{const response=await fetch('/data/map-weather-cities.json.gz?v=20261116',{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('The city directory is temporarily unavailable.');const blob=await response.blob();if(blob.size>8*1024*1024)throw Error('Invalid city directory.');return blob;})().catch(e=>{index=null;throw e;});return index;
}
self.onmessage=async event=>{
 const {id,point,cancel}=event.data,token=++generation;if(cancel)return;
 const check=()=>{if(token!==generation)throw new DOMException('Aborted','AbortError');};
 try{
  if(!GregleWeather.coordinates(point.latitude,point.longitude))throw Error('Invalid map point.');
  const blob=await cityIndex();check();let best=null;
  await GregleOfflineStore.scanFeatures(blob.stream().pipeThrough(new DecompressionStream('gzip')),row=>{const candidate=GregleMapWeatherData.cityCandidate(row,point,best?.distance??Infinity);if(candidate)best=candidate;},check);
  check();if(!best)throw Error('No nearby forecast city was found.');
  self.postMessage({id,city:best});
 }catch(e){if(token===generation)self.postMessage({id,error:e.message});}
};
