(function(root) {
  'use strict';
  const ENDPOINT='https://gregle-canadian-radar.square-rain-5ded.workers.dev';
  const STATIONS={
    CASAG:{id:'CASAG',name:'Aldergrove, BC',lat:49.016441,lon:-122.487357},
    CASHP:{id:'CASHP',name:'Halfmoon Peak, BC',lat:49.527035,lon:-123.853712}
  };
  // The fourteen DPQPE rain legend colours, from light to heavy (mm/h).
  const COLOURS=[[153,204,255],[0,153,255],[0,255,102],[0,204,0],[0,153,0],[0,102,0],[255,255,51],[255,204,0],[255,153,0],[255,102,0],[255,0,0],[255,0,153],[153,51,204],[102,0,153]];
  const palette=new Set(COLOURS.map(([r,g,b])=>(r<<16)|(g<<8)|b));
  function sourceFor(station) {
    if(!Object.hasOwn(STATIONS,station))throw Error('Unsupported Canadian station');
    return {...STATIONS[station],provider:'eccc',endpoint:ENDPOINT};
  }
  function framesFrom(data,station,now=Date.now()) {
    const source=sourceFor(station);
    if(data?.station!==station || !Array.isArray(data.frames))throw Error('Invalid Canadian radar metadata');
    const frames=data.frames.filter(f=>Number.isSafeInteger(f.time) && f.time*1000>=now-3*3600000 && f.time*1000<=now+60000 && /^\d{8}T\d{4}Z$/.test(f.code))
      .filter(f=>new Date(f.time*1000).toISOString().replace(/[-:]/g,'').slice(0,13)+'Z'===f.code)
      .sort((a,b)=>a.time-b.time).filter((f,i,a)=>!i || f.time!==a[i-1].time).slice(-25)
      .map(f=>({time:f.time,path:`ca:${station}:${f.code}`,hd:{...source,code:f.code,url:`${ENDPOINT}/stations/${station}/images/${f.code}.gif`}}));
    if(!frames.length)throw Error('No recent Canadian radar frames');
    return {host:'',frames};
  }
  function pixelFor(lat,lon,site) {
    // Station-centred azimuthal equidistant grid: 480 x 480, 1 km/pixel.
    const d=Math.PI/180,p=lat*d,p0=site.lat*d,dl=(lon-site.lon)*d;
    const a=Math.sin((p-p0)/2)**2+Math.cos(p0)*Math.cos(p)*Math.sin(dl/2)**2;
    const c=2*Math.asin(Math.sqrt(Math.min(1,a))),k=c<1e-12?1:c/Math.sin(c);
    return [240+6371*k*Math.cos(p)*Math.sin(dl),240-6371*k*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(dl))];
  }
  function rainPixels(rgba,width=480,height=480) {
    const out=new Uint8ClampedArray(width*height*4);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++) {
      // Remove the frame, national banner and non-radar pixels, including all
      // source basemap colours; the right-hand legend is outside this crop.
      if((x<200 && y<22) || (x-240)**2+(y-240)**2>240**2)continue;
      const i=(y*width+x)*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];
      if(palette.has((r<<16)|(g<<8)|b)){out[i]=r;out[i+1]=g;out[i+2]=b;out[i+3]=255;}
    }
    return out;
  }
  function validateLegend(rgba) {
    for(let i=0;i<14;i++) {
      const rgb=COLOURS[13-i],offset=(i*15+7)*4;
      if(rgb.some((v,j)=>rgba[offset+j]!==v))throw Error('Canadian image colour scale changed');
    }
  }
  function tileLookup(coords,site,size=256) {
    const out=new Int32Array(size*size).fill(-1),world=size*2**coords.z;
    const west=coords.x*size/world*360-180,east=(coords.x+1)*size/world*360-180;
    const north=Math.atan(Math.sinh(Math.PI*(1-2*coords.y*size/world)))*180/Math.PI;
    const south=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+1)*size/world)))*180/Math.PI;
    if(east<site.lon-3.7 || west>site.lon+3.7 || north<site.lat-2.2 || south>site.lat+2.2)return out;
    const longitudes=Array.from({length:size},(_,x)=>(coords.x*size+x+.5)/world*360-180);
    for(let y=0;y<size;y++) {
      const lat=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y*size+y+.5)/world)))*180/Math.PI;
      for(let x=0;x<size;x++) {
        const [sx,sy]=pixelFor(lat,longitudes[x],site),ix=Math.floor(sx),iy=Math.floor(sy);
        if(ix>=0 && ix<480 && iy>=0 && iy<480)out[y*size+x]=(iy*480+ix)*4;
      }
    }
    return out;
  }
  const core={ENDPOINT,STATIONS,COLOURS,sourceFor,framesFrom,pixelFor,rainPixels,validateLegend,tileLookup};
  if(typeof module!=='undefined' && module.exports){module.exports=core;return;}
  const decoded=new Map(),lookups=new Map();
  function pixels(frame) {
    if(decoded.has(frame.path))return decoded.get(frame.path);
    const pending=new Promise((resolve,reject)=>{
      const img=new root.Image();img.crossOrigin='anonymous';
      const timer=setTimeout(()=>{img.src='';reject(Error('Canadian image timed out'));},12000);
      img.onerror=()=>{clearTimeout(timer);reject(Error('Canadian image unavailable'));};
      img.onload=()=>{
        clearTimeout(timer);
        try {
          if(img.naturalWidth!==580 || img.naturalHeight!==480)throw Error('Canadian image format changed');
          const canvas=document.createElement('canvas');canvas.width=580;canvas.height=480;
          const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0);
          validateLegend(context.getImageData(530,144,1,210).data);
          resolve(rainPixels(context.getImageData(0,0,480,480).data));
        }catch(error){reject(error);}
      };
      img.src=frame.hd.url;
    });
    decoded.set(frame.path,pending);pending.catch(()=>{if(decoded.get(frame.path)===pending)decoded.delete(frame.path);});
    while(decoded.size>3)decoded.delete(decoded.keys().next().value);
    return pending;
  }
  root.GregleCanadianRadar={...core,
    async load(station,signal) {
      sourceFor(station);
      const response=await fetch(`${ENDPOINT}/stations/${station}/frames`,{signal,cache:'no-cache'});
      if(!response.ok)throw Error('Canadian radar unavailable');
      return framesFrom(await response.json(),station);
    },
    createLayer(frame) {
      const Layer=root.L.GridLayer.extend({createTile(coords,done){
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
        pixels(frame).then(data=>{
          const key=`${frame.hd.id}:${coords.z}:${coords.x}:${coords.y}`;
          let lookup=lookups.get(key);
          if(!lookup){lookup=tileLookup(coords,frame.hd);lookups.set(key,lookup);while(lookups.size>24)lookups.delete(lookups.keys().next().value);}
          const context=canvas.getContext('2d'),image=context.createImageData(256,256);
          for(let i=0;i<lookup.length;i++){const src=lookup[i];if(src<0 || !data[src+3])continue;const dst=i*4;image.data[dst]=data[src];image.data[dst+1]=data[src+1];image.data[dst+2]=data[src+2];image.data[dst+3]=255;}
          context.putImageData(image,0,0);done(null,canvas);
        }).catch(error=>done(error,canvas));
        return canvas;
      }});
      return new Layer({tileSize:256,opacity:0,zIndex:300,minZoom:2,maxZoom:10,updateWhenIdle:true,keepBuffer:0,
        attribution:'Radar: <a href="https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radarimage-datamart_en/">ECCC / DPQPE</a>'});
    }
  };
})(globalThis);
