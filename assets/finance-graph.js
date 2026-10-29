(() => {
  'use strict';
  const host=document.getElementById('graphApplet');
  const loading=document.getElementById('graphLoading');
  const status=document.getElementById('graphStatus');
  const retry=document.getElementById('graphRetry');
  let api=null,failed=false,scheduled=false,lastWidth=0,lastHeight=0;
  const size=()=>({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight});
  function resize() {
    if(scheduled || !api) return;
    scheduled=true;
    window.requestAnimationFrame(()=>{
      scheduled=false;
      const {width,height}=size();
      if(width>0 && height>0 && (width!==lastWidth || height!==lastHeight)) {
        api.setSize(width,height); lastWidth=width; lastHeight=height;
      }
    });
  }
  function fail() {
    if(api || failed) return;
    failed=true; clearTimeout(timer);
    host.hidden=true; retry.hidden=false;
    status.textContent='Graphing could not load. Check your connection, then try again.';
  }
  const timer=setTimeout(fail,45000);
  const script=document.createElement('script');
  script.src='https://www.geogebra.org/apps/deployggb.js';
  script.async=true;
  script.onerror=fail;
  script.onload=()=>{
    if(failed) return;
    try {
      const {width,height}=size();
      const applet=new window.GGBApplet({
        appName:'graphing',width:Math.max(1,width),height:Math.max(1,height),
        showAlgebraInput:true,showToolBar:false,showMenuBar:false,
        showFullscreenButton:false,showStartTooltip:false,enableFileFeatures:false,
        allowStyleBar:true,enableShiftDragZoom:true,preventFocus:true,
        showKeyboardOnFocus:'auto',disableJavaScript:true,language:'en',borderColor:'#ffffff',
        appletOnLoad(instance) {
          if(failed) return;
          api=instance; clearTimeout(timer); loading.hidden=true; resize();
        }
      },true);
      applet.inject('graphApplet');
    } catch (_) { fail(); }
  };
  document.head.append(script);
  retry.addEventListener('click',()=>window.location.reload());
  window.addEventListener('resize',resize);
  if(typeof ResizeObserver!=='undefined') new ResizeObserver(resize).observe(document.documentElement);
  // Forward Escape from the embedded calculator to its own floating panel.
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && window.parent!==window) {
      event.preventDefault();
      window.parent.postMessage({type:'gregle-calculator-close'},window.location.origin);
    }
  },true);
})();
