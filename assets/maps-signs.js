(() => {
  'use strict';
  window.GregleDriveBCSigns = ({ map, config, notify }) => {
    const core = window.GregleSignsCore;
    const time = value => new Date(value).toLocaleString(undefined, { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
    function createSource(type) {
      const speed = type === 'speed', label = speed ? 'Variable speed signs' : 'Message signs';
      const output = document.getElementById(`drivebc-${type}-status`), group = L.layerGroup(), displayed = new Map();
      const endpoint = speed ? config.speedSignsURL : config.messageSignsURL;
      const attribution = `${label}: <a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a> (<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">OGL-BC</a>)`;
      const refreshEvery = speed ? 120000 : 300000, maxCacheAge = 900000;
      let enabled = false, snapshot, controller, version = 0, refresh, debounce, retryAt = 0, failures = 0;
      const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
      function coversBC() {
        const b = map.getBounds();
        return b.getSouth() <= 60.1 && b.getNorth() >= 48 && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => b.getWest() + shift <= -114 && b.getEast() + shift >= -139.1));
      }
      function inView([lat, lng]) {
        const b = map.getBounds();
        return lat >= b.getSouth() && lat <= b.getNorth() && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => lng >= b.getWest() + shift && lng <= b.getEast() + shift));
      }
      function popup(sign) {
        const box = document.createElement('div'); box.className = 'drivebc-popup drivebc-sign-popup';
        box.style.width = `${Math.max(150, Math.min(310, map.getSize().x - 120))}px`;
        const title = document.createElement('strong'); title.textContent = sign.name;
        const road = document.createElement('p'); road.textContent = [sign.road, sign.direction].filter(Boolean).join(' · ');
        box.append(title, road);
        const usable = core.available(sign, type, Date.now()) && snapshot && Date.now() - snapshot.checked <= maxCacheAge;
        if (usable && speed) {
          const value = document.createElement('div'); value.className = 'drivebc-speed-reading';
          value.textContent = `${sign.posted} km/h`; box.append(value);
          if (sign.status.toLowerCase() === 'pixel error') {
            const fault = document.createElement('p'); fault.className = 'drivebc-meta';
            fault.textContent = 'DriveBC reports a display pixel fault. The reported speed is shown above.'; box.append(fault);
          }
        } else if (usable && sign.pages?.length) {
          sign.pages.forEach((page, index) => {
            const heading = document.createElement('p'); heading.className = 'drivebc-meta'; heading.textContent = `Reported message · page ${index + 1}`;
            const message = document.createElement('pre'); message.className = 'drivebc-message-display'; message.textContent = page;
            box.append(heading, message);
          });
        } else {
          const unavailable = document.createElement('p');
          unavailable.textContent = !sign.enabled ? 'Sign is off or disabled; no current reading.' : usable ? 'Sign is blank; no message is currently reported.' : 'Current reading unavailable: the feed is old, the sign is offline or no usable reading was supplied.';
          box.append(unavailable);
        }
        if (speed && sign.regular !== null) {
          const regular = document.createElement('p'); regular.textContent = `Regular maximum: ${sign.regular} km/h`; box.append(regular);
        }
        const status = document.createElement('p'); status.className = 'drivebc-meta'; status.textContent = `Sign status: ${sign.status || 'Not supplied'}`;
        const changed = document.createElement('p'); changed.className = 'drivebc-meta'; changed.textContent = sign.changed ? `Last changed ${time(sign.changed)}` : 'Change time not supplied';
        const checked = document.createElement('p'); checked.className = 'drivebc-meta'; checked.textContent = `Feed checked ${time(speed ? snapshot.checked : sign.fetched)}${speed ? '' : ' · published about every 15 minutes'}`;
        const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener';
        link.href = speed ? `https://twm.th.gov.bc.ca/?c=vsls&lon=${sign.point[1]}&lat=${sign.point[0]}&z=12` : 'https://www.drivebc.ca/';
        link.textContent = speed ? 'Open BC speed-sign map ↗' : 'Open DriveBC ↗';
        box.append(status, changed, checked, link); return box;
      }
      function icon(sign, ready) {
        return L.divIcon({ className: `drivebc-sign-marker drivebc-sign-${type}${ready ? '' : ' drivebc-sign-unavailable'}`, html: speed ? `<span aria-hidden="true">${ready ? sign.posted : '?'}</span>` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M6 7h12M6 11h12M7 16v5m10-5v5"/></svg>', iconSize: [36, 32], iconAnchor: [18, 16] });
      }
      function clear() { group.clearLayers(); displayed.clear(); }
      function render() {
        if (!coversBC()) { clear(); report(`${label} cover British Columbia. Move the map to BC to see signs.`); return; }
        const data = snapshot && Date.now() - snapshot.checked <= maxCacheAge ? snapshot : null;
        const signs = data ? data.signs.filter(sign => inView(sign.point)) : [];
        const visible = new Set(signs.map(sign => sign.id));
        for (const [id, entry] of displayed) if (!visible.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
        for (const sign of signs) {
          const ready = !!core.available(sign, type, Date.now()), previous = displayed.get(sign.id);
          if (previous) {
            if (JSON.stringify(previous.sign) !== JSON.stringify(sign) || previous.ready !== ready) {
              previous.marker.setLatLng(sign.point); previous.marker.setIcon(icon(sign, ready)); previous.marker.setPopupContent(() => popup(sign));
              previous.sign = sign; previous.ready = ready;
            }
            continue;
          }
          const marker = L.marker(sign.point, { icon: icon(sign, ready), title: `${speed ? 'Variable speed sign' : 'Dynamic message sign'}: ${sign.name}`, alt: label, keyboard: true, riseOnHover: true, bubblingMouseEvents: false });
          marker.bindPopup(() => popup(sign), { minWidth: 150, maxWidth: 340, maxHeight: Math.max(80, map.getSize().y - 220), autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
          displayed.set(sign.id, { sign, ready, marker });
        }
        const failed = retryAt > Date.now();
        const stale = data && !speed && Date.now() - Date.parse(data.fetched) > 2700000;
        report(data ? `${signs.length} ${label.toLowerCase()} in this view · ${speed ? 'updates every two minutes' : `snapshot checked ${time(data.fetched)}`}.${stale ? ' Snapshot is old; messages are unavailable.' : ''}${failed ? ' Refresh failed; cached locations shown while waiting to retry.' : ''}` : failed ? `${label} are unavailable. Another check will run later.` : `Loading ${label.toLowerCase()}…`, failed || !!stale);
      }
      function cancel() { version++; controller?.abort(); controller = null; clearTimeout(refresh); clearTimeout(debounce); }
      function schedule(delay) {
        clearTimeout(refresh);
        const now = Date.now(), deadlines = snapshot ? [snapshot.checked + maxCacheAge + 1] : [];
        for (const sign of snapshot?.signs || []) {
          if (speed && sign.received) deadlines.push(Date.parse(sign.received) + 900001);
          if (!speed) { deadlines.push(Date.parse(sign.fetched) + 2700001); if (sign.received) deadlines.push(Date.parse(sign.received) + 2700001); if (sign.expires) deadlines.push(Date.parse(sign.expires) + 1); }
        }
        const nextExpiry = Math.min(...deadlines.filter(value => value > now)) - now;
        if (Number.isFinite(nextExpiry)) delay = Math.min(delay, nextExpiry);
        if (enabled && !document.hidden && coversBC()) refresh = setTimeout(load, Math.max(0, Math.min(2147483647, delay)));
      }
      async function load() {
        if (!enabled || document.hidden) return;
        clearTimeout(refresh); render();
        if (!coversBC()) { cancel(); return; }
        if (controller) return;
        if (Date.now() < retryAt) { schedule(retryAt - Date.now()); return; }
        if (snapshot && Date.now() - snapshot.checked < refreshEvery) { schedule(refreshEvery - (Date.now() - snapshot.checked)); return; }
        const requestVersion = version, active = new AbortController(); controller = active;
        const timeout = setTimeout(() => active.abort(), 12000); let delay = refreshEvery;
        try {
          const response = await fetch(endpoint, { signal: active.signal, credentials: 'omit', cache: 'no-cache' });
          if (!response.ok) {
            const error = new Error('Sign feed unavailable'), retry = response.headers.get('Retry-After');
            error.retryAfter = retry === null ? 0 : /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
            throw error;
          }
          const data = speed ? core.readSpeed(await response.json()) : core.readMessages(await response.json());
          if (requestVersion !== version || !enabled || document.hidden) return;
          snapshot = { ...data, checked: Date.now() }; failures = 0; retryAt = 0;
        } catch (error) {
          if (requestVersion !== version || !enabled || document.hidden) return;
          failures++;
          delay = Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0, Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)));
          retryAt = Date.now() + delay; notify(`${label} could not refresh. Open Layers for details.`, `drivebc-${type}`);
        } finally {
          clearTimeout(timeout);
          if (requestVersion === version) { controller = null; render(); schedule(delay); }
        }
      }
      function setEnabled(value) {
        const next = value === true; if (next === enabled) return;
        enabled = next; cancel();
        if (enabled) { group.addTo(map); map.attributionControl.addAttribution(attribution); load(); }
        else { clear(); map.removeLayer(group); map.attributionControl.removeAttribution(attribution); }
      }
      map.on('moveend', () => { if (enabled && !document.hidden) { clearTimeout(debounce); debounce = setTimeout(load, 150); } });
      document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) cancel(); else load(); });
      window.addEventListener('pagehide', cancel);
      window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
      return { setEnabled };
    }
    const sources = { speed: createSource('speed'), messages: createSource('messages') };
    return { setEnabled(type, value) { sources[type]?.setEnabled(value); } };
  };
})();
