// Bounded, wire-type-checked decoder for the GTFS-RT VehiclePosition subset.
// Field numbers: https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto
const decoder=new TextDecoder('utf-8',{fatal:true});
function fields(bytes) {
  if(!(bytes instanceof Uint8Array))throw Error('Invalid protobuf message');
  const out=[];let offset=0;
  function varint(){let value=0,shift=0;for(let i=0;i<10;i++){if(offset>=bytes.length)throw Error('Truncated varint');const b=bytes[offset++];value+=(b&127)*2**shift;if(!Number.isSafeInteger(value))throw Error('Oversized varint');if(b<128)return value;shift+=7;}throw Error('Invalid varint');}
  while(offset<bytes.length){
    if(out.length>=50000)throw Error('Too many fields');
    const key=varint(),id=Math.floor(key/8),wire=key%8;let value;
    if(!id||id>536870911)throw Error('Invalid field');
    if(wire===0)value=varint();
    else if(wire===2){const size=varint();if(size>bytes.length-offset)throw Error('Truncated message');value=bytes.subarray(offset,offset+size);offset+=size;}
    else if(wire===5||wire===1){const size=wire===5?4:8;if(size>bytes.length-offset)throw Error('Truncated fixed field');value=wire===5?new DataView(bytes.buffer,bytes.byteOffset+offset,4).getFloat32(0,true):bytes.subarray(offset,offset+8);offset+=size;}
    else throw Error('Unsupported wire type');
    out.push({id,wire,value});
  }
  return out;
}
function get(message,id,wire,fallback){const f=message.findLast(f=>f.id===id);if(!f)return fallback;if(f.wire!==wire)throw Error('Invalid field type');return f.value;}
const nested=(message,id)=>fields(get(message,id,2,new Uint8Array()));
const string=(message,id)=>{const bytes=get(message,id,2,new Uint8Array());if(bytes.length>300)throw Error('Oversized identifier');return decoder.decode(bytes).trim();};
const number=(message,id)=>get(message,id,0,undefined);
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function readVehicles(bytes,now,maxAgeSeconds) {
  if(!bytes.length||bytes.length>2*1024*1024)throw Error('Invalid feed size');
  const root=fields(bytes),header=nested(root,1),timestamp=number(header,3)*1000;
  if(!['1.0','2.0'].includes(string(header,1))||(number(header,2)||0)!==0||!finite(timestamp,now-maxAgeSeconds*1000,now+30000))throw Error('Stale or unsupported feed');
  const entities=root.filter(f=>f.id===2),seen=new Map();
  if(entities.length>10000)throw Error('Too many vehicles');
  for(const entity of entities){
    if(entity.wire!==2)throw Error('Invalid entity');
    const e=fields(entity.value);if(number(e,2)===1)continue;
    const v=nested(e,4),trip=nested(v,1),position=nested(v,2),vehicle=nested(v,8);
    const routeId=string(trip,5),tripId=string(trip,1),id=string(vehicle,1)||string(e,1),observed=number(v,5)*1000;
    const lat=get(position,1,5,undefined),lng=get(position,2,5,undefined),bearing=get(position,3,5,undefined),direction=number(trip,6),relationship=number(trip,4);
    // Never replace a missing GPS timestamp with the feed refresh time.
    if(!id||!routeId||[3,7].includes(relationship)||!finite(lat,48.25,60)||!finite(lng,-139.1,-114)||!finite(observed,now-maxAgeSeconds*1000,now+30000))continue;
    if((seen.get(id)?.observed||0)>=observed)continue;
    seen.set(id,{id,label:string(vehicle,2)||id,tripId,routeId,lat,lng,observed,bearing:finite(bearing,0,360)?bearing:null,direction:[0,1].includes(direction)?direction:null});
  }
  return {timestamp,vehicles:[...seen.values()]};
}
export async function readBytes(response) {
  if(!response.body)throw Error('Empty feed');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw Error('Oversized feed');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
