(function(root) {
  'use strict';
  function create(env) {
    let map=null,group=null,sites=[],visible=false,selected='',onSelect=()=>{};
    const markers=new Map();
    function decorate(marker,site) {
      const node=marker.getElement();
      if(!node)return;
      node.classList.toggle('is-selected',site.id===selected);
      node.setAttribute('aria-label',`${site.id} · ${site.name} · Select radar station`);
      node.setAttribute('aria-pressed',String(site.id===selected));
    }
    function render() {
      if(!map || !group)return;
      if(visible){if(!map.hasLayer(group))group.addTo(map);}
      else if(map.hasLayer(group))map.removeLayer(group);
    }
    function build() {
      if(!group)return;
      group.clearLayers();markers.clear();
      for(const site of sites) {
        const marker=env.L.marker([site.lat,site.lon],{
          pane:'radarStations',keyboard:true,bubblingMouseEvents:false,
          title:`${site.id} · ${site.name}`,
          icon:env.L.divIcon({className:'radar-station-marker',html:'<span aria-hidden="true"></span>',iconSize:[26,26],iconAnchor:[13,13]})
        });
        const label=env.document.createElement('span');label.textContent=`${site.id} · ${site.name}`;
        marker.bindTooltip(label,{direction:'top',offset:[0,-5],className:'radar-station-tooltip'});
        marker.on('click',()=>onSelect(site.id));
        marker.on('add',()=>{
          decorate(marker,site);
          marker.getElement()?.addEventListener('keydown',event=>{
            if(event.key===' '){event.preventDefault();onSelect(site.id);}
          });
        });
        markers.set(site.id,{marker,site});group.addLayer(marker);
      }
    }
    return {
      attach(value,select){
        map=value;onSelect=select;
        const pane=map.getPane('radarStations') || map.createPane('radarStations');pane.style.zIndex='500';
        group=env.L.layerGroup();build();render();
      },
      setSites(value){sites=value;build();},
      setVisible(value){visible=Boolean(value);render();},
      select(value){
        const previous=selected;selected=value;
        for(const id of new Set([previous,selected])){const entry=markers.get(id);if(entry)decorate(entry.marker,entry.site);}
      }
    };
  }
  if(typeof module!=='undefined' && module.exports){module.exports={create};return;}
  root.GregleRadarStations=create(root);
})(globalThis);
