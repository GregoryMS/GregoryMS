(() => {
  'use strict';
  const A = window.GregleAstro;
  const $ = id => document.getElementById(id);
  function create({onSelect, onChart}) {
    let sites = [], map, cluster, marker, directoryVersion = 0, selected = null, place = null;
    let controller, mapFailed = false;
    function el(tag, text, className) {
      const e = document.createElement(tag); if (text !== undefined) e.textContent = text;
      if (className) e.className = className; return e;
    }
    function choose(site) { onSelect({...site}); }
    function renderList(list, searching = false) {
      $('site-results').replaceChildren(...list.map(site => {
        const button = el('button', undefined, 'site-result'); button.type = 'button';
        button.setAttribute('aria-pressed', String(site.key === selected?.key));
        const swatch = el('i', undefined, 'site-swatch'); swatch.style.backgroundColor = site.color;
        swatch.setAttribute('aria-hidden', 'true');
        const text = el('span'); text.append(el('strong', site.name), el('small', [site.bortle || 'Sky rating unavailable', Number.isFinite(site.distance) ? site.distance.toFixed(1) + ' km away' : site.key].join(' · ')));
        button.append(swatch, text); button.addEventListener('click', () => choose(site)); return button;
      }));
      $('site-list-label').textContent = searching ? 'Matching chart sites' : 'Nearby chart sites · within 200 km';
      if (!list.length) $('site-results').append(el('p', searching ? 'No chart sites match. Try a shorter name, or use city search above.' : 'No chart site within 200 km. Explore the map or search for a named observatory. Local weather remains available below.', 'empty'));
    }
    function redrawList() {
      const query = $('site-query').value.trim();
      renderList(query ? A.searchSites(sites, query) : place ? A.nearbySites(sites, place) : [], !!query);
    }
    function setLocation(next) {
      place = next;
      const nearby = A.nearbySites(sites, place);
      selected = next.site ? sites.find(s => s.key === next.site.key) || null : nearby[0] || null;
      $('site-query').value = ''; redrawList();
      if (map) {
        map.setView([place.latitude, place.longitude], 8);
        marker.setLatLng([place.latitude, place.longitude]);
      }
      onChart(selected ? {...selected, distance: A.distance(place, selected)} : null);
    }
    function initMap() {
      if (map || mapFailed) return;
      if (!window.L?.markerClusterGroup) {
        mapFailed = true; $('map-status').textContent = 'Interactive map unavailable. You can still search and select chart sites from the list.'; return;
      }
      map = L.map('sites-map', {scrollWheelZoom:false}).setView([49.28, -123.12], 8);
      const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
      const light = L.tileLayer('https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_{z}_{x}_{y}.png', {
        minZoom:2, maxNativeZoom:6, maxZoom:18, tileSize:1024, zoomOffset:-2, opacity:0.6,
        attribution:'Light pollution: <a href="https://djlorenz.github.io/astronomy/lp/">David Lorenz 2024</a>'
      }).addTo(map);
      base.on('tileerror', () => { $('map-status').textContent = 'Some map tiles are unavailable. Chart-site markers and the site list still work.'; });
      light.on('tileerror', () => { $('map-status').textContent = 'Some light-pollution tiles are unavailable; blank areas are not confirmed dark skies.'; });
      L.control.layers({'Street map':base}, {'Light pollution · Lorenz 2024':light}, {collapsed:false}).addTo(map);
      cluster = L.markerClusterGroup({chunkedLoading:true, maxClusterRadius:45});
      map.addLayer(cluster);
      marker = L.circleMarker([49.28,-123.12], {radius:11, weight:3, color:'#ffffff', fillColor:'#0b1726', fillOpacity:1}).addTo(map);
      map.on('click', event => {
        const point = {latitude:event.latlng.lat, longitude:event.latlng.lng};
        const near = A.nearbySites(sites, point, 1)[0];
        if (near) choose(near); else $('map-status').textContent = 'No chart site within 200 km of that point. Try another area or a named site.';
      });
      $('map-status').textContent = 'Choose a coloured marker or a site from the list. Click a cluster to zoom in; click open map space to select the nearest chart site within 200 km.';
    }
    function addMarkers() {
      if (!map) return;
      cluster.clearLayers();
      const markers = sites.map(site => {
        const dot = el('span', undefined, 'chart-pin'); dot.style.backgroundColor = site.color;
        const pin = L.marker([site.latitude, site.longitude], {
          icon:L.divIcon({html:dot, className:'chart-marker', iconSize:[20,20], iconAnchor:[10,10]}), title:site.name, alt:site.name, keyboard:true
        });
        pin.on('click', () => choose(site)); return pin;
      });
      cluster.addLayers(markers);
    }
    async function loadDirectory() {
      const version = ++directoryVersion; controller?.abort(); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      $('directory-status').textContent = 'Loading observing sites…';
      try {
        const response = await fetch('data/astro-sites.json', {signal:controller.signal});
        if (!response.ok) throw Error('Directory unavailable');
        const data = await response.json(), parsed = A.parseSites(data);
        if (version !== directoryVersion) return;
        sites = parsed; initMap(); addMarkers();
        $('directory-status').textContent = `${sites.length.toLocaleString()} chart sites · Directory snapshot ${data.updated} · Clear Sky Chart / Dark Dragons Astronomy`;
        if (place) setLocation(place);
      } catch (_) {
        if (version === directoryVersion) $('directory-status').textContent = 'Chart directory unavailable. Try Reload sites or open the original map. Weather forecasts remain available.';
      } finally { clearTimeout(timeout); }
    }
    $('site-query').addEventListener('input', redrawList);
    $('reload-sites').addEventListener('click', loadDirectory);
    $('recenter-map').addEventListener('click', () => { if (map && place) map.setView([place.latitude, place.longitude], 8); });
    $('all-sites').addEventListener('click', () => { if (map) map.fitBounds([[15,-170],[75,-50]]); });
    initMap(); loadDirectory();
    return {setLocation};
  }
  window.GregleAstroSites = {create};
})();
