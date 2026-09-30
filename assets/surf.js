(function(root) {
  'use strict';
  const S=root.GregleSurf,T=root.GregleTides,U=root.GregleTideUI,$=id=>document.getElementById(id);
  let marine=null,wind=null,day=null,zone='UTC',chosen=null,place=null,version=0,loading=false,fetchedAt=null;
  const number=(value,unit,decimals=0)=>Number.isFinite(value)?value.toFixed(decimals)+' '+unit:'Unavailable';
  const from=value=>S.direction(value)?'From '+S.direction(value)+' · '+Math.round(value)+'°':'Direction unavailable';
  function card(label,value,detail) {
    const el=U.node('div','surf-card');el.append(U.node('dt','range-label',label),U.node('dd','surf-value',value),U.node('dd','surf-detail',detail));return el;
  }
  function render() {
    const rows=S.hours(marine,wind,day,zone),select=$('surfHour');
    if(!rows.some(r=>r.time===chosen))chosen=S.defaultTime(rows,day,zone);
    select.replaceChildren(...rows.map(row=>{const option=U.node('option','',new Date(row.time).toLocaleTimeString('en-CA',{timeZone:zone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}));option.value=String(row.time);return option;}));
    select.disabled=!rows.length;select.value=chosen===null?'':String(chosen);
    const row=rows.find(r=>r.time===chosen)||{};
    $('surfDate').textContent=day?new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'})+' · '+zone.replaceAll('_',' '):'';
    $('surfCards').replaceChildren(
      card('Wave height',number(row.wave_height,'m',1),from(row.wave_direction)),
      card('Wave period',number(row.wave_period,'s',1),'Time between waves'),
      card('Swell',number(row.swell_wave_height,'m',1),from(row.swell_wave_direction)+' · '+number(row.swell_wave_period,'s',1)),
      card('Wind',number(row.wind_speed_10m,'km/h'),from(row.wind_direction_10m)),
      card('Wind gusts',number(row.wind_gusts_10m,'km/h'),'At 10 m above the surface'),
      card('Water temperature',number(row.sea_surface_temperature,'°C',1),'Modelled sea surface temperature')
    );
    const hasWave=rows.some(r=>Number.isFinite(r.wave_height)),hasWind=rows.some(r=>Number.isFinite(r.wind_speed_10m));
    $('surfStatus').textContent=loading?'Loading surf conditions for '+place.name+'…':!hasWave && !hasWind?'Surf conditions are unavailable for this day and location. Try Refresh or choose a coastal city.':(!hasWave?'Wave data unavailable for this day. ':!hasWind?'Wind data unavailable for this day. ':'')+'Forecast for '+place.name+' · Updated '+U.time(fetchedAt,zone)+(marine?' · Sea model '+marine.distance.toFixed(1)+' km away':'');
    $('surfPanel').setAttribute('aria-busy',String(loading));
  }
  async function load(location,signal,selectedDay) {
    const id=++version;place=location;marine=null;wind=null;chosen=null;loading=true;fetchedAt=null;zone=T.timezone(location.timezone);day=selectedDay||T.dayKey(Date.now(),zone);render();
    const results=await Promise.allSettled([S.request(location,'marine',signal),S.request(location,'wind',signal)]);
    if(id!==version || signal.aborted)return;
    marine=results[0].status==='fulfilled'?results[0].value:null;wind=results[1].status==='fulfilled'?results[1].value:null;
    if(!selectedDay && !dayLocked){zone=wind?.timezone||marine?.timezone||zone;day=T.dayKey(Date.now(),zone);}
    loading=false;fetchedAt=Date.now();render();
  }
  let dayLocked=false;
  root.GregleSurfUI={load(location,signal,selectedDay){dayLocked=!!selectedDay;return load(location,signal,selectedDay);},setDay(value,timezone){dayLocked=true;const changed=day!==value;day=value;zone=timezone;if(changed)chosen=null;render();}};
  $('surfHour').addEventListener('change',()=>{chosen=Number($('surfHour').value);render();});
})(globalThis);
