import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
export function matches(data,x,y,z,term,onlyPlaces=false){
 const tile=new VectorTile(new Pbf(new Uint8Array(data))),matches=[];
 for(const name of (onlyPlaces?['place_labels']:['place_labels','street_labels','street_labels_points','pois','public_transport'])){
  const layer=tile.layers[name];if(!layer)continue;
  for(let i=0;i<layer.length;i++){
   const feature=layer.feature(i),p=feature.properties,label=p.name_en||p.name||p.ref;
   if(typeof label!=='string'||!label.toLocaleLowerCase().includes(term))continue;
   const geometry=feature.loadGeometry(),line=geometry[Math.floor(geometry.length/2)],point=line?.[Math.floor(line.length/2)];if(!point)continue;
   const n=2**z,lng=(x+point.x/feature.extent)/n*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+point.y/feature.extent)/n)))*180/Math.PI;
   matches.push({lat,lng,name:label,kind:name==='place_labels'?'place':name==='pois'?'place of interest':name==='public_transport'?'transit stop':'road'});
   if(matches.length>=30)return matches;
  }
 }
 return matches;
}
