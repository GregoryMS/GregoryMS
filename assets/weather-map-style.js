(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.GregleWeatherMap=api;
})(globalThis,function() {
  'use strict';
  // Universal Blue RGBA values from RainViewer's published colour table:
  // https://www.rainviewer.com/files/rainviewer_api_colors_table.csv
  // Rain is restyled by reflectivity; snow retains the provider's blue scale.
  const RADAR_COLOURS={"63615914":"98e698","66635a19":"96e696","69665c1e":"93e593","6c685d24":"90e490","6f6b5f29":"8ee48e","726e612e":"8ce48c","75706234":"89e389","78736439":"86e286","7c75653e":"84e284","7f786744":"82e282","827b6949":"7fe17f","857d6a4e":"7ce07c","88806c54":"7ae07a","8b826d59":"78e078","8e856f5e":"75df75","92887164":"72de72","9e93756e":"70de70","aa9e7978":"6ede6e","b6a97e82":"6bdd6b","c2b4828c":"68dc68","cec08796":"66dc66","d2c48ba0":"5fd863","d6c88faa":"58d361","dacc93b4":"52cf5e","ded097be":"4bcb5c","88ddeeff":"44c659","6cd1ebff":"3dc256","51c5e8ff":"36be54","36bae5ff":"30ba51","1baee2ff":"29b54f","00a3e0ff":"22b14c","009ad5ff":"1fab49","0091caff":"1ba646","0088bfff":"18a043","007fb4ff":"149a40","0077aaff":"11943c","0070a3ff":"0e8f39","00699cff":"0a8936","006295ff":"078333","005b8eff":"037e30","005588ff":"00782d","005180ff":"338f24","004e78ff":"66a61b","004a70ff":"99bd12","004768ff":"ccd409","ffee00ff":"ffeb00","ffe000ff":"ffdb00","ffd200ff":"ffca00","ffc500ff":"ffba00","ffb700ff":"ffa900","ffaa00ff":"ff9900","ff9f00ff":"fd8406","ff9500ff":"fb6f0d","ff8b00ff":"f95a13","ff8100ff":"f7451a","ff4400ff":"f53020","f23600ff":"ed2b1f","e62800ff":"e5261f","d91b00ff":"dd221e","cd0d00ff":"d51d1d","c10000ff":"cd181c","a80000ff":"c5131c","8f0000ff":"bd0e1b","760000ff":"b50a1a","5d0000ff":"ad051a","ffaaffff":"a50019","ff9fffff":"a10019","ff95ffff":"9d0019","ff8bffff":"990019","ff81ffff":"950019","ff77ffff":"910019","ff6cffff":"8d0019","ff62ffff":"890019","ff58ffff":"850019","ff4effff":"810019","ffffffff":"7d0019","00ff00ff":"690019","ceffff0c":"ceffff","cdffff19":"cdffff","ccffff26":"ccffff","cbffff33":"cbffff","cbffff3f":"cbffff","caffff4c":"caffff","c9ffff59":"c9ffff","c8ffff66":"c8ffff","c7ffff72":"c7ffff","c7ffff7f":"c7ffff","c6ffff8c":"c6ffff","c5ffff99":"c5ffff","c4ffffa5":"c4ffff","c3ffffb2":"c3ffff","c3ffffbf":"c3ffff","c2ffffcc":"c2ffff","c1ffffd8":"c1ffff","c0ffffe5":"c0ffff","bffffff2":"bfffff","bfffffff":"bfffff","b8f8ffff":"b8f8ff","b2f2ffff":"b2f2ff","abebffff":"abebff","a5e5ffff":"a5e5ff","9fdfffff":"9fdfff","98d8ffff":"98d8ff","92d2ffff":"92d2ff","8bcbffff":"8bcbff","85c5ffff":"85c5ff","7fbfffff":"7fbfff","78b8ffff":"78b8ff","72b2ffff":"72b2ff","6babffff":"6babff","65a5ffff":"65a5ff","5f9fffff":"5f9fff","5b9bffff":"5b9bff","5898ffff":"5898ff","5595ffff":"5595ff","5292ffff":"5292ff","4f8fffff":"4f8fff","4b8bffff":"4b8bff","4888ffff":"4888ff","4585ffff":"4585ff","4282ffff":"4282ff","3f7fffff":"3f7fff","3b7bffff":"3b7bff","3878ffff":"3878ff","3575ffff":"3575ff","3272ffff":"3272ff","2f6fffff":"2f6fff","2b6bffff":"2b6bff","2868ffff":"2868ff","2565ffff":"2565ff","2262ffff":"2262ff","1f5fffff":"1f5fff","1b5bffff":"1b5bff","1858ffff":"1858ff","1555ffff":"1555ff","1252ffff":"1252ff","0f4fffff":"0f4fff","0c4bffff":"0c4bff","0948ffff":"0948ff","0645ffff":"0645ff","0242ffff":"0242ff","003fffff":"003fff","003bffff":"003bff","0038ffff":"0038ff","0035ffff":"0035ff","0032ffff":"0032ff","002fffff":"002fff","002bffff":"002bff","0028ffff":"0028ff","0025ffff":"0025ff","0022ffff":"0022ff","001fffff":"001fff","001bffff":"001bff","0018ffff":"0018ff","0015ffff":"0015ff","0012ffff":"0012ff","000fffff":"000fff","000cffff":"000cff","0009ffff":"0009ff","0006ffff":"0006ff","0002ffff":"0002ff","0000ffff":"0000ff"};
  // ECCC SfcPrecipType_Dis legend: retain snow, rain and hail classes;
  // give mixed rain/snow and freezing rain separate pink scales.
  const PRECIP_COLOURS={e0bde6:'f7b6da',c36dd2:'ec6aac','9b27af':'be267d',fecbc8:'ffb5c4',fe1e0d:'ed174c'};
  const rgb=hex=>[0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16));
  const radarTable=Object.entries(RADAR_COLOURS).map(([source,target])=>[...rgb(source),parseInt(source.slice(6),16),rgb(target)]);
  const radarCache=new Map();
  const precipCache=new Map();
  function colour(r,g,b,a,kind) {
    const key=((r<<24)|(g<<16)|(b<<8)|a)>>>0,cache=kind==='radar'?radarCache:precipCache;
    if(cache.has(key))return cache.get(key);
    let result=null,best=Infinity;
    if(kind==='radar') {
      for(const [sr,sg,sb,sa,target] of radarTable) {
        const distance=(r-sr)**2+(g-sg)**2+(b-sb)**2+(a-sa)**2;
        if(distance<best){best=distance;result=target;}
      }
      // Allow PNG/canvas premultiplication rounding, not arbitrary new colours.
      if(best>144)result=null;
    } else {
      for(const [source,target] of Object.entries(PRECIP_COLOURS)) {
        const [sr,sg,sb]=rgb(source),distance=(r-sr)**2+(g-sg)**2+(b-sb)**2;
        if(distance<best){best=distance;result=rgb(target);}
      }
      if(best>144)result=null;
    }
    // Bound lifetime memory even if a provider changes its PNG encoding.
    if(cache.size>=8192)cache.clear();
    cache.set(key,result);return result;
  }
  function recolour(pixels,kind) {
    for(let i=0;i<pixels.length;i+=4) {
      if(!pixels[i+3])continue;
      const target=colour(pixels[i],pixels[i+1],pixels[i+2],pixels[i+3],kind);
      if(target){pixels[i]=target[0];pixels[i+1]=target[1];pixels[i+2]=target[2];}
    }
    return pixels;
  }
  function basemap(L) {
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
      subdomains:'abcd',maxZoom:19,className:'weather-basemap',
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });
  }
  const classes=new WeakMap();
  function tiles(win,url,options,kind) {
    const Parent=kind==='radar'?win.L.TileLayer:win.L.TileLayer.WMS;
    let Layer=classes.get(Parent);
    if(!Layer) {
      Layer=Parent.extend({
        options:{weatherPalette:kind},
        _removeTile(key) {
          this._tiles[key]?.el.cancelWeatherImage?.();
          Parent.prototype._removeTile.call(this,key);
        },
        createTile(coords,done) {
          const tile=win.document.createElement('canvas'),size=this.getTileSize();
          tile.width=size.x;tile.height=size.y;
          const image=new win.Image();image.crossOrigin='anonymous';image.alt='';
          let finished=false;
          const finish=error=>{if(finished)return;finished=true;image.onload=image.onerror=null;done(error,tile);};
          tile.cancelWeatherImage=()=>{finished=true;image.onload=image.onerror=null;image.src='';};
          image.onload=()=>{
            if(finished)return;
            try {
              const ctx=tile.getContext('2d',{willReadFrequently:true});
              ctx.drawImage(image,0,0,tile.width,tile.height);
              const data=ctx.getImageData(0,0,tile.width,tile.height);
              recolour(data.data,this.options.weatherPalette);ctx.putImageData(data,0,0);finish(null);
            }catch(error){finish(error);}
          };
          image.onerror=()=>finish(new Error('Weather tile could not load'));
          image.src=this.getTileUrl(coords);return tile;
        }
      });
      classes.set(Parent,Layer);
    }
    const layer=new Layer(url,{...options,weatherPalette:kind});
    return layer;
  }
  return {basemap,recolour,tiles};
});
