(() => {
 'use strict';
 window.GregleVictoriaParking=({map})=>{
  const $=id=>document.getElementById(id),core=window.GregleParking,group=L.layerGroup().addTo(map),renderer=L.canvas({padding:.2});
  let enabled=false,snapshot,pending,generation=0;
  const report=text=>$('victoria-parking-status').textContent=text;
  const money=n=>'$'+n.toFixed(2);
  function popup(title,lines,url){const box=document.createElement('div'),heading=document.createElement('strong');heading.textContent=title;box.append(heading);for(const line of lines){const p=document.createElement('p');p.textContent=line;box.append(p);}const link=document.createElement('a');link.textContent='City of Victoria parking information ↗';link.href=url;link.target='_blank';link.rel='noopener';box.append(link);return box;}
  function draw(){
   group.clearLayers();if(!enabled||!snapshot||document.hidden)return;
   const bounds=map.getBounds();const inView=p=>bounds.contains([p[1],p[0]]);
   const inside=bounds.intersects([[48.405,-123.395],[48.45,-123.335]]);
   if(!inside){report('Victoria parking is enabled. Use Show Victoria to view the mapped spaces.');return;}
   let count=0;
   if(map.getZoom()>=15)for(const s of snapshot.spaces){
    if(!inView(s.point))continue;const z=core.zones[s.zone];count++;
    const marker=L.circleMarker([s.point[1],s.point[0]],{renderer,radius:3.5,color:z.colour,weight:2,fillColor:z.colour,fillOpacity:1,bubblingMouseEvents:false,title:'Parking zone '+s.zone}).addTo(group);
    marker.bindTooltip('Zone '+s.zone+' · '+money(z.rate)+'/hr · '+z.limit);
    marker.bindPopup(()=>popup('Metered parking · Zone '+s.zone,[s.meter?'Space / meter '+s.meter:'General metered space','Mon–Sat: '+money(z.rate)+'/hr · '+z.limit,'Sunday: '+money(z.sundayRate)+'/hr · '+z.sundayLimit,'Paid daily 8 a.m.–8 p.m.; free evenings and designated holidays.',...(s.zone===4?['The City rate table lists 4 hours; some GIS records list 3 hours. Follow the posted time limit.']:[]),'Mapped location, not live availability. Check signs for local restrictions.'],'https://www.victoria.ca/getting-around/parking/street-parking'));
   }
   const numbers={'Yates Street Parkade':1,'Broughton Street Parkade':2,'Centennial Square Parkade':3,'Johnson Street Parkade':4,'View Street Parkade':5};
   for(const f of snapshot.facilities){if(!inView(f.point))continue;
    const lot=f.kind==='lot';const icon=L.divIcon({className:'victoria-parking-marker'+(lot?' is-lot':''),html:'<span>P</span>'+(numbers[f.name]?'<small>'+numbers[f.name]+'</small>':''),iconSize:[32,32],iconAnchor:[16,16]});
    const marker=L.marker([f.point[1],f.point[0]],{icon,title:f.name,alt:f.name,bubblingMouseEvents:false}).addTo(group);
    const info=lot?['City surface lot · paid 24/7, including holidays.']:['City parkade · paid Mon–Sat, 8 a.m.–8 p.m.; free Sundays and designated holidays.'];
    marker.bindPopup(()=>popup(f.name,[...info,'No live availability shown. See the City page for facility-specific prices and conditions.'],'https://www.victoria.ca/getting-around/parking/parkades-surface-lots'));
   }
   report((map.getZoom()<15?'Zoom in to level 15 for individual metered spaces. ':count+' general metered spaces in view. ')+'Snapshot checked '+snapshot.checked+' · no live availability.');
  }
  async function load(){const token=++generation;report('Loading Victoria parking…');try{
   if(!snapshot){if(!pending)pending=fetch('data/victoria-parking.json?v=20261113',{signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(core.read).then(d=>snapshot=d).finally(()=>{pending=null;});await pending;}
   if(enabled&&token===generation)draw();
  }catch(error){console.warn('Victoria parking layer:',error);if(enabled&&token===generation)report('Parking data could not load. Turn the layer off and on to retry.');}}
  $('victoria-parking-show').addEventListener('click',()=>map.setView([48.4254,-123.3647],16));
  map.on('moveend zoomend',draw);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)group.clearLayers();else if(enabled)load();});
  window.addEventListener('pagehide',()=>{generation++;group.clearLayers();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&enabled)load();});
  return {setEnabled(value){enabled=value;generation++;group.clearLayers();if(enabled)load();}};
 };
})();
