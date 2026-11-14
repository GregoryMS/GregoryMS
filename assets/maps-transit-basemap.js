(() => {
  'use strict';
  let library;
  const script = src => new Promise((resolve, reject) => {
    const node = document.createElement('script'); node.src = src;
    const timer = setTimeout(() => { node.remove(); reject(Error('Map library timed out')); }, 20000);
    node.onload = () => { clearTimeout(timer); resolve(); };
    node.onerror = () => { clearTimeout(timer); node.remove(); reject(Error('Map library unavailable')); };
    document.head.append(node);
  });
  async function load() {
    if (!window.maplibregl) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css'; document.head.append(css);
      await script('https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js');
    }
    if (!window.MaplibreGLLeaflet) await script('assets/leaflet-maplibre-gl.js?v=0.1.4');
  }
  window.GregleTransitBasemap = ({map, onStatus}) => {
    const group = L.layerGroup(); let version = 0, timer, vector;
    const credit = '© <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    group.on('add', async () => {
      const token = ++version;
      const fallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, maxNativeZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(group);
      onStatus('Loading OpenFreeMap · 2D transit map…');
      try {
        if (!library) library = load().catch(error => { library = null; throw error; });
        await library;
        if (token !== version || !map.hasLayer(group)) return;
        vector = window.MaplibreGLLeaflet.maplibreGL({style:'https://tiles.openfreemap.org/styles/positron', interactive:false, attributionControl:{customAttribution:credit}, pane:'tilePane'});
        vector.addTo(group);
        const gl = vector.getMaplibreMap();
        let loaded = false;
        const fail = () => {
          if (token !== version || loaded) return;
          clearTimeout(timer); group.removeLayer(vector); vector = null;
          onStatus('OpenFreeMap unavailable · OpenStreetMap base with Gregle transit overlays.');
        };
        gl.once('load', () => {
          if (token !== version) return;
          loaded = true; clearTimeout(timer); group.removeLayer(fallback);
          onStatus('OpenFreeMap · clear 2D base with bus and rapid transit overlays');
        });
        gl.on('error', () => { if (!loaded) fail(); });
        timer = setTimeout(fail, 25000);
        gl.getCanvas().setAttribute('aria-hidden', 'true');
      } catch {
        if (token === version) onStatus('OpenFreeMap unavailable · OpenStreetMap base with Gregle transit overlays.');
      }
    });
    group.on('remove', () => { version++; clearTimeout(timer); group.clearLayers(); vector = null; });
    return group;
  };
})();
