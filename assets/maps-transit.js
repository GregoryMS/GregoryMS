(() => {
  'use strict';
  window.GregleTransit = ({map,enableTransit=()=>{}}) => {
    const core = window.GregleTransitCore, group = L.layerGroup(), cache = new Map(), boards = new Map();
    const hint = document.getElementById('transit-map-hint'), status = document.getElementById('transit-map-status');
    const options = document.getElementById('transit-options'), zoomButton = document.getElementById('transit-zoom'), retryButton = document.getElementById('transit-retry');
    const credit = 'Departures: <a href="https://transitous.org/" target="_blank" rel="noopener">Transitous</a> · <a href="https://transitous.org/sources/" target="_blank" rel="noopener">operators &amp; licences</a>';
    let enabled = false, version = 0, controller, departureController, boardVersion = 0, debounce, staleTimer, nextRequest = 0, retryAt = 0, selectedMarker;
    const make = (tag,text,className) => {const el=document.createElement(tag); if(text)el.textContent=text; if(className)el.className=className; return el;};
    const link = (text,url) => {const el=make('a',text);el.href=url;el.target='_blank';el.rel='noopener noreferrer';return el;};
    const report = (text,retry=false,zoom=false) => {status.textContent=text;retryButton.hidden=!retry;zoomButton.hidden=!zoom;};
    const bounds = () => {const b=map.getBounds();return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];};
    const routeView=window.GregleTransitRoute?.({map,requestJSON:json,canRequest:()=>Date.now()>=retryAt,onStop:openStop});
    const network=window.GregleTransitNetwork?.({map,enableTransit,onStop:openStop,onRoute:(data,stops)=>routeView?.showNetwork(data,stops)});
    let routeSelected=false;
    function cancelBoard() {boardVersion++;departureController?.abort();departureController=null;clearTimeout(staleTimer);}
    function cancel() {version++;controller?.abort();controller=null;clearTimeout(debounce);cancelBoard();}
    async function json(url,signal) {
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok){const retry=response.headers.get('Retry-After'),seconds=/^\d+$/.test(retry||'')?Number(retry):Math.max(0,(Date.parse(retry||'')-Date.now())/1000);retryAt=Date.now()+Math.max(30000,Math.min(3600000,seconds*1000||30000));throw Error('Transit service unavailable');}
      return response.json();
    }
    function render(stops) {
      if(routeSelected)return;
      const b=map.getBounds(), west=b.getWest(), east=b.getEast(), wrap=value=>((value+180)%360+360)%360-180;
      const visible=stops.filter(stop=>stop.lat>=b.getSouth()&&stop.lat<=b.getNorth()&&((stop.lng-wrap(west)+360)%360)<=east-west);
      const zoom=map.getZoom(),stationIds=new Set(visible.filter(s=>core.major(s)&&!s.parent).map(s=>s.id));
      const candidates=visible.filter(stop=>(zoom>=14||core.major(stop))&&!(core.major(stop)&&stationIds.has(stop.parent))).sort((a,b)=>Number(core.major(b))-Number(core.major(a)));
      const project=stop=>map.latLngToContainerPoint([stop.lat,stop.lng]),layout=window.GregleTransitNetworkCore;
      const show=layout&&map.latLngToContainerPoint?layout.spaced(candidates,project,zoom<14?35:zoom<16?24:15,180):candidates.slice(0,500);
      const labels=new Set(layout&&map.latLngToContainerPoint?layout.spaced(show.filter(s=>core.major(s)?zoom>=12:zoom>=16),project,170,40):[]);
      const openId=selectedMarker?.transitStop?.id;
      // Reuse the current marker while its board is open; rebuilding it would
      // close the popup during Leaflet's automatic pan to keep it on screen.
      for(const marker of group.getLayers())if(marker.transitStop.id!==openId)group.removeLayer(marker);
      // A viewport refresh may choose another feed's equivalent marker. Keep
      // the selected boarding point open while it remains physically in view.
      // load() closes it when the user pans away.
      for(const stop of show){
        if(group.getLayers().some(marker=>marker.transitStop.id===stop.id))continue;
        const marker=addMarker(stop);
        const label=make('span',stop.name);marker.bindTooltip?.(label,{permanent:labels.has(stop),direction:'right',offset:[10,0],className:'transit-stop-label'});
      }
      report(show.length?`${show.length} stops & stations · tap for departures${zoom<16?' · zoom in for more names':''}`:zoom<14?'Rapid transit overview · choose Bus routes, or zoom in for stops.':visible.length?'Zoom in for more bus stops.':'No published stops in this view. Try a nearby area.',false,zoom<16);
    }
    function addMarker(stop){
        const rail=core.major(stop),icon=L.divIcon({className:`transit-stop-marker${rail?' transit-station-marker':''}`,html:rail?'<span aria-hidden="true">▣</span>':'<span aria-hidden="true">●</span>',iconSize:[rail?26:18,rail?26:18],iconAnchor:[rail?13:9,rail?13:9]});
        const marker=L.marker([stop.lat,stop.lng],{icon,title:`${stop.name}${stop.platform?' · '+stop.platform:''}${stop.code?' · '+stop.code:''} · departures`,alt:`Departures at ${stop.name}`,keyboard:true,riseOnHover:true,bubblingMouseEvents:false});
        marker.transitStop=stop;
        let popupContent;
        marker.bindPopup(()=>popupContent||(popupContent=popup(stop,marker)),{minWidth:220,maxWidth:350,maxHeight:Math.max(140,map.getSize().y-170),autoPan:false,className:'gregle-transit-popup'});
        marker.on('popupopen',()=>{selectedMarker=marker;hint.hidden=true;keepPopupOnScreen(marker);const el=marker.getPopup().getElement?.();if(el&&typeof ResizeObserver!=='undefined'){marker.transitPopupObserver?.disconnect();marker.transitPopupObserver=new ResizeObserver(()=>keepPopupOnScreen(marker));marker.transitPopupObserver.observe(el);}});
        marker.on('popupclose',()=>{marker.transitPopupObserver?.disconnect();popupContent=null;if(selectedMarker===marker){selectedMarker=null;cancelBoard();hint.hidden=!enabled;}});
        marker.addTo(group);
        return marker;
    }
    function keepPopupOnScreen(marker){
      const el=marker.getPopup().getElement?.(),container=map.getContainer?.();if(!el||!container)return;
      if(container.closest('.map-stage')?.classList.contains('has-mobile-drawer')){el.style.translate='';return;}
      const area=container.getBoundingClientRect(),viewport=window.visualViewport;
      const frame={left:Math.max(area.left,viewport?.offsetLeft||0)+12,right:Math.min(area.right,(viewport?.offsetLeft||0)+(viewport?.width||window.innerWidth))-12,top:Math.max(area.top+85,viewport?.offsetTop||0),bottom:Math.min(area.bottom,(viewport?.offsetTop||0)+(viewport?.height||window.innerHeight))-16};
      const scaleX=area.width/container.clientWidth||1,scaleY=area.height/container.clientHeight||1;
      const content=el.querySelector('.leaflet-popup-content');if(content){content.style.maxHeight=Math.max(60,(frame.bottom-frame.top)/scaleY-44)+'px';content.style.overflowY='auto';}
      el.style.translate='none';const offset=core.popupOffset(el.getBoundingClientRect(),frame);
      el.style.translate=`${offset.x/scaleX}px ${offset.y/scaleY}px`;el.classList.toggle('transit-popup-clamped',Math.abs(offset.x)>1||Math.abs(offset.y)>1);
    }
    function openStop(stop){
      if(!enabled)return;
      const marker=group.getLayers().find(m=>m.transitStop.id===stop.id)||addMarker(stop);
      marker.openPopup();
    }
    async function load() {
      if(!enabled||document.hidden)return;
      if(selectedMarker){const stop=selectedMarker.transitStop,b=map.getBounds(),middle=(((b.getWest()+b.getEast())/2+180)%360+360)%360-180;if(stop.lat<b.getSouth()||stop.lat>b.getNorth()||Math.abs(stop.lng-middle)>(b.getEast()-b.getWest())/2)map.closePopup();}
      const local=network?.stops();if(local){controller?.abort();version++;render(local);return;}
      const view=core.area(bounds(),map.getZoom());
      if(!view){group.clearLayers();map.closePopup();const center=map.getCenter(),scope=core.region(center.lat,((center.lng+180)%360+360)%360-180);report(scope?'Zoom in to see stops and station schedules.':'Station schedules cover BC and the London area.',false,!!scope);return;}
      const key=core.stopsURL(view),cached=cache.get(key);
      if(cached&&Date.now()-cached.time<300000){render(cached.stops);return;}
      if(Date.now()<retryAt){report('Transit data is temporarily unavailable. Please retry shortly.',true);return;}
      if(Date.now()<nextRequest){clearTimeout(debounce);debounce=setTimeout(load,nextRequest-Date.now());return;}
      controller?.abort();const request=new AbortController();controller=request;const token=++version;nextRequest=Date.now()+3000;
      report('Loading stops and stations…');
      try{const stops=core.readStops(await json(key,request.signal),view);if(token!==version||!enabled||document.hidden)return;cache.set(key,{time:Date.now(),stops});while(cache.size>8)cache.delete(cache.keys().next().value);render(stops);}
      catch(error){if(token===version&&!request.signal.aborted)report('Stops could not load. Please retry shortly.',true);}
      finally{if(token===version)controller=null;}
    }
    function popup(stop,marker) {
      cancelBoard();
      const box=make('section',null,'transit-popup');box.setAttribute('aria-label',`${stop.name} departures`);
      box.style.width=`${Math.max(210,Math.min(330,map.getSize().x-100))}px`;
      Object.assign(marker.getPopup().options,{maxHeight:Math.max(140,map.getSize().y-170)});
      box.append(make('h3',stop.name),make('p',`${stop.code?'Stop '+stop.code+' · ':''}${stop.platform?'Bay / platform '+stop.platform+' · ':''}${stop.scope==='london'?'London':'British Columbia'}`,'transit-meta'));
      const heading=make('h4','Upcoming departures'),note=make('p','Loading departures…','transit-meta');note.setAttribute('role','status');
      const content=make('div'),actions=make('div',null,'transit-actions');
      const refresh=make('button','Departures now'),later=make('button','Later departures'),back=make('button','Previous');
      for(const button of [refresh,back,later]){button.type='button';actions.append(button);}
      back.hidden=true;later.hidden=true;
      const official=stop.scope==='london'?'https://tfl.gov.uk/plan-a-journey/':stop.id.startsWith('ca-bc-TransLink_')?'https://www.translink.ca/schedules-and-maps':'https://www.bctransit.com/';
      box.append(heading,note,make('p','Tap a route number to highlight its path and stops.','transit-meta'),content,actions,link('Operator schedules & service information ↗',official),make('p','Times are local to this stop. Live estimates appear only when supplied by the operator.','transit-meta'),link('Transitous · data sources & licences ↗','https://transitous.org/sources/'));
      let start=new Date().toISOString(),cursor='',history=[],next='',lastAction=0;
      function display(board,checked) {
        const zone=board.zone||stop.zone;
        content.replaceChildren();next=board.next;later.hidden=!next;back.hidden=!history.length;
        const old=Date.now()-checked>=60000;
        note.textContent=`${old?'Earlier snapshot':'Checked'} ${core.clock(checked,zone)}${old?' · refresh for current predictions':''}`;
        heading.textContent=history.length?'Later departures':'Upcoming departures';
        if(!board.rows.length)content.append(make('p','No departures returned for this stop in this time window. Check the operator for service information.'));
        const list=make('ol',null,'transit-departures');
        for(const row of board.rows){
          const li=make('li'),route=make(routeView&&row.tripId?'button':'strong',row.route,'transit-route');
          if(routeView&&row.tripId){route.type='button';route.title=`Show entire route ${row.route}`;route.setAttribute('aria-label',route.title);route.addEventListener('click',async()=>{if(!await network?.showDeparture(row,stop))routeView.show(row,stop);});}
          const time=make('time',core.clock(row.time,zone));time.dateTime=new Date(row.time).toISOString();
          const state=row.cancelled?'Cancelled':row.live?(old?'Earlier estimate':'Live estimate'):'Scheduled';
          li.append(route,make('span',row.headsign,'transit-destination'),time,make('small',`${state}${row.platform?' · Platform '+row.platform:''}${row.operator?' · '+row.operator:''}`));
          if(row.live&&row.time!==row.scheduled)li.append(make('small',`Scheduled ${core.clock(row.scheduled,zone)}`));
          if(row.cancelled)li.classList.add('transit-cancelled');
          list.append(li);
        }
        content.append(list);
        for(const alert of board.alerts)content.append(make('p',alert,'transit-alert'));
        const routes=new Map();for(const row of board.rows)if(row.url)routes.set(row.route,row.url);
        if(routes.size){const details=make('details'),links=make('div',null,'transit-route-links');details.append(make('summary','Route schedules'));for(const [route,url]of routes)links.append(link(route+' ↗',url));details.append(links);content.append(details);}
        marker.getPopup().update();keepPopupOnScreen(marker);
        clearTimeout(staleTimer);if(!old)staleTimer=setTimeout(()=>{if(box.isConnected)display(board,checked);},Math.max(1,checked+60001-Date.now()));
      }
      async function board(force=false) {
        if(!enabled||document.hidden)return;
        cancelBoard();const token=boardVersion,key=core.departuresURL(stop,start,cursor),saved=boards.get(key);
        if(!force&&saved&&Date.now()-saved.time<30000){display(saved.board,saved.time);return;}
        if(Date.now()<retryAt){note.textContent='Transit data is temporarily unavailable. Please retry shortly.';return;}
        const request=new AbortController();departureController=request;
        note.textContent='Loading departures…';content.setAttribute('aria-busy','true');
        for(const button of [refresh,back,later])button.disabled=true;
        try{const result=core.readDepartures(await json(key,request.signal),stop);if(token!==boardVersion||!enabled||document.hidden)return;const time=Date.now();boards.set(key,{board:result,time});while(boards.size>20)boards.delete(boards.keys().next().value);display(result,time);}
        catch(error){if(token===boardVersion&&!request.signal.aborted){content.replaceChildren();later.hidden=true;note.textContent='Departures could not load. Try Departures now, or open the operator schedules.';}}
        finally{if(token===boardVersion){content.removeAttribute('aria-busy');for(const button of [refresh,back,later])button.disabled=false;departureController=null;marker.getPopup().update();keepPopupOnScreen(marker);}}
      }
      const act=fn=>{if(Date.now()-lastAction<1500)return;lastAction=Date.now();fn();};
      refresh.addEventListener('click',()=>act(()=>{history=[];cursor='';start=new Date().toISOString();board(true);}));
      later.addEventListener('click',()=>act(()=>{if(next){history.push(cursor);cursor=next;board();}}));
      back.addEventListener('click',()=>act(()=>{if(history.length){cursor=history.pop();board();}}));
      // Leaflet attaches popup contents after the factory returns.
      setTimeout(()=>{if(enabled&&box.isConnected)board();},0);
      return box;
    }
    function setEnabled(value) {
      if(enabled===(value===true))return;
      enabled=value===true;cancel();hint.hidden=!enabled;options.hidden=!enabled;
      routeView?.setEnabled(enabled);
      network?.setEnabled(enabled);
      if(enabled){group.addTo(map);map.attributionControl.addAttribution(credit);load();}
      else{group.clearLayers();map.removeLayer(group);map.attributionControl.removeAttribution(credit);selectedMarker=null;}
    }
    zoomButton.addEventListener('click',()=>map.setZoom(Math.max(15,map.getZoom()+1)));
    retryButton.addEventListener('click',load);
    map.on('transitnetworkready',load);
    map.on('resize zoomend moveend',()=>{if(selectedMarker)keepPopupOnScreen(selectedMarker);});
    map.on('transitroutechange',event=>{routeSelected=event.active;if(routeSelected){group.clearLayers();selectedMarker=null;}else if(enabled)load();});
    map.on('moveend',()=>{if(enabled&&!document.hidden){controller?.abort();version++;controller=null;clearTimeout(debounce);debounce=setTimeout(load,500);}});
    document.addEventListener('visibilitychange',()=>{cancel();if(document.hidden){map.closePopup();}else if(enabled)load();});
    window.addEventListener('pagehide',()=>{cancel();map.closePopup();});
    window.addEventListener('pageshow',event=>{if(event.persisted&&enabled)load();});
    return {setEnabled};
  };
})();
