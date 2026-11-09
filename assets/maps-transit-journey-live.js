(() => {
  'use strict';
  window.GregleTransitJourneyLive=({map,onStop,onReplan})=>{
    const $=id=>document.getElementById(id),core=window.GregleTransitJourneyCore,nav=window.GregleNavigation,card=$('transit-navigation'),stage=document.querySelector('.map-stage');
    const vehicles=window.GregleTransitVehicles?.({map,statusElement:$('transit-guidance-vehicles'),creditElement:$('transit-guidance-credit')});
    let running=false,session=0,journey,index=0,phase='walk',watch=null,timer,marker,previous,lastFix,follow=true,voice=false,announced=new Set(),latestPoint;
    function say(text){if(!voice||document.hidden||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;window.speechSynthesis.cancel();const u=new window.SpeechSynthesisUtterance(text);u.lang='en';window.speechSynthesis.speak(u);}
    const report=text=>{$('transit-guidance-status').textContent=text;};
    function uncertain(text){const leg=journey.legs[index];$('transit-guidance-alert').hidden=true;$('transit-guidance-cue').textContent=leg.walk?`Walk to ${leg.to.name}`:phase==='board'?`Board ${leg.route} toward ${leg.headsign}`:`On ${leg.route} · get off at ${leg.to.name}`;report(text);}
    function clear(){session++;running=false;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearInterval(timer);vehicles?.clear();if(marker)map.removeLayer(marker);marker=null;previous=null;lastFix=null;latestPoint=null;window.speechSynthesis?.cancel();card.hidden=true;stage.classList.remove('navigating');}
    function stop(message='Transit guidance stopped. Your journey steps are still available.'){clear();onStop(message);}
    function render(){
      const leg=journey.legs[index],next=journey.legs[index+1];
      $('transit-guidance-progress').textContent=`Step ${index+1} of ${journey.legs.length} · arrive ${core.clock(journey.end,journey.zone)}`;
      $('transit-guidance-step').textContent=core.stepText(leg);
      $('transit-guidance-cue').textContent=leg.walk?`Walk to ${leg.to.name}`:phase==='board'?`Board ${leg.route} toward ${leg.headsign}`:`On ${leg.route} · get off at ${leg.to.name}`;
      $('transit-guidance-next').textContent=leg.walk?(next?'I’m at the stop':'Finish journey'):phase==='board'?'I’m on board':next?.interline?'Continue on board':'I’ve got off';
      $('transit-guidance-alert').hidden=true;announced=new Set();previous=null;
      vehicles?.clear();if(!leg.walk)vehicles?.show({routeId:leg.routeId,route:leg.route});
      report(phase==='board'?`Check the route and destination before boarding. Departure ${core.clock(leg.start,leg.from.zone)} · ${leg.live?'live estimate':'scheduled'}.`:'Waiting for a fresh GPS location. Keep this page open for timely alerts.');
      map.fitBounds(L.latLngBounds(leg.points),{paddingTopLeft:[25,Math.min(360,map.getSize().y*.45)],paddingBottomRight:[50,40],maxZoom:16});
    }
    function advance(){
      const leg=journey.legs[index];
      if(phase==='board'){phase='ride';render();return;}
      if(index===journey.legs.length-1){stop('You’ve finished your transit journey.');return;}
      index++;const next=journey.legs[index];phase=next.walk?'walk':next.interline&&!leg.walk?'ride':'board';render();
    }
    function position(fix,token){
      if(!running||token!==session||document.hidden)return;
      const now=Date.now(),leg=journey.legs[index],p={lat:fix.coords?.latitude,lng:fix.coords?.longitude};
      if(!nav.valid(p)||!Number.isFinite(fix.timestamp)||fix.timestamp<now-20000||fix.timestamp>now+5000||!Number.isFinite(fix.coords.accuracy)||fix.coords.accuracy>80){uncertain('GPS is not accurate enough for stop alerts. Check the stop names and use the step buttons.');return;}
      lastFix=fix;latestPoint=p;
      if(!marker)marker=L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:3,fillColor:'#7637cc',fillOpacity:1}).addTo(map);else marker.setLatLng([p.lat,p.lng]);
      if(follow)map.panTo([p.lat,p.lng],{animate:false});
      if(phase==='board'){const missed=now>leg.start+120000;report(missed?'This departure may have left. Check live departures or tap Replan.':`Board at ${leg.from.name}. Tap “I’m on board” once aboard the correct service.`);return;}
      const result=core.guidance(leg,fix,previous,now);
      if(!result.reliable){uncertain('Your location does not match this leg reliably. Follow the stop names or tap Replan.');return;}
      previous=result;
      if(leg.walk){
        $('transit-guidance-cue').textContent=result.atEnd?`You’re near ${leg.to.name}`:result.next?.text||`Walk to ${leg.to.name}`;
        report(`${nav.distance(result.remaining)} remaining. ${result.atEnd?'Confirm arrival below.':'Follow the dotted walking path.'}`);
      }else{
        const continuation=journey.legs[index+1]?.interline;
        const cue=continuation&&(result.getOffSoon||result.atEnd)?`Stay on board — continues as ${journey.legs[index+1].route}`:result.atEnd?`Arriving at ${leg.to.name} — get off here`:result.getOffSoon?`Get off soon at ${leg.to.name}`:`On ${leg.route} · get off at ${leg.to.name}`;
        $('transit-guidance-cue').textContent=cue;report(`${nav.distance(result.remaining)} along the route to ${leg.to.name}. Confirm ${continuation?'continuing on board':'getting off'} below.`);
        $('transit-guidance-alert').hidden=!result.getOffSoon;$('transit-guidance-alert').textContent=cue;
        const key=`${index}:${result.atEnd?'arriving':'soon'}`;
        if(result.getOffSoon&&!announced.has(key)){announced.add(key);say(cue);}
      }
    }
    function start(route){
      clear();journey=route;index=0;phase=journey.legs[0].walk?'walk':'board';follow=true;running=true;const token=session;card.hidden=false;stage.classList.add('navigating');$('transit-guidance-follow').textContent='Following';$('transit-guidance-follow').setAttribute('aria-pressed','true');render();
      timer=setInterval(()=>{if(running&&(!lastFix||Date.now()-lastFix.timestamp>20000||document.hidden)){uncertain(document.hidden?'Alerts may pause while this page is hidden.':'GPS signal lost. Stop alerts resume with a fresh location; use the step buttons meanwhile.');}},5000);
      if(!navigator.geolocation?.watchPosition){report('GPS guidance is unavailable. You can still follow the journey using the step buttons.');return;}
      try{watch=navigator.geolocation.watchPosition(fix=>position(fix,token),error=>{if(token===session&&running){lastFix=null;uncertain(error.code===1?'Location access was denied. Allow location for get-off alerts, or follow the steps manually.':'Waiting for GPS. Follow the stop names and step buttons meanwhile.');}},{enableHighAccuracy:true,maximumAge:0,timeout:15000});}catch{report('Live location could not start. Follow the steps manually or check location permission.');}
    }
    $('transit-guidance-next').addEventListener('click',()=>{if(running)advance();});
    $('transit-guidance-stop').addEventListener('click',()=>stop());
    $('transit-guidance-replan').addEventListener('click',()=>{if(running){const point=lastFix&&Date.now()-lastFix.timestamp<20000?latestPoint:null;clear();onReplan(point);}});
    $('transit-guidance-follow').addEventListener('click',()=>{follow=true;$('transit-guidance-follow').textContent='Following';$('transit-guidance-follow').setAttribute('aria-pressed','true');if(marker)map.panTo(marker.getLatLng(),{animate:false});});
    map.on('dragstart',()=>{if(running){follow=false;$('transit-guidance-follow').textContent='Recenter';$('transit-guidance-follow').setAttribute('aria-pressed','false');}});
    $('transit-guidance-voice').hidden=!window.speechSynthesis||!window.SpeechSynthesisUtterance;
    $('transit-guidance-voice').addEventListener('click',()=>{voice=!voice;$('transit-guidance-voice').textContent=voice?'Voice on':'Voice off';$('transit-guidance-voice').setAttribute('aria-pressed',String(voice));if(voice)say($('transit-guidance-cue').textContent);else window.speechSynthesis?.cancel();});
    document.addEventListener('visibilitychange',()=>{if(running){previous=null;lastFix=null;uncertain('Waiting for a fresh GPS location. Keep this page open for timely stop alerts.');}});
    window.addEventListener('pagehide',clear);
    return {start,stop,get active(){return running;}};
  };
})();
