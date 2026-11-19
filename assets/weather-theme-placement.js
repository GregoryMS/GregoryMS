(function(root) {
  'use strict';
  function placeTheme(env) {
    const doc=env.document,toggle=doc.getElementById('themeToggle'),menu=doc.getElementById('gregleAppMenu');
    const menuHome=doc.getElementById('weatherMenuThemeHome'),settingsHome=doc.getElementById('weatherSettingsThemeHome'),row=doc.getElementById('weatherSettingsThemeRow');
    if(!toggle || !menu || !menuHome || !settingsHome || !row)return;
    const mobile=env.matchMedia('(max-width:700px)');
    function sync() {
      // Installed apps can hide the launcher; Settings remains available there.
      const inSettings=mobile.matches || menu.hidden;
      const home=inSettings?settingsHome:menuHome;
      if(toggle.parentElement!==home)home.append(toggle);
      row.hidden=!inSettings;menuHome.hidden=inSettings;
    }
    sync();
    if(mobile.addEventListener)mobile.addEventListener('change',sync);
    else mobile.addListener?.(sync);
    env.addEventListener('pageshow',sync);
    if(env.MutationObserver)new env.MutationObserver(sync).observe(menu,{attributes:true,attributeFilter:['hidden']});
  }
  if(typeof module!=='undefined' && module.exports){module.exports={placeTheme};return;}
  placeTheme(root);
})(globalThis);
