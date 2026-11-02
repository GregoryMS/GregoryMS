(() => {
  'use strict';
  const core = window.GregleBusynessCore;
  const storageKey = 'gregle-maps-busyness-pause-v1';
  let library;

  async function loadGoogle() {
    if (library) return library;
    library = (async () => {
      const response = await fetch('/api/maps/google-config', {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw Error('configuration');
      const config = await response.json();
      if (!config.enabled || typeof config.browserKey !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(config.browserKey)) throw Error('configuration');
      if (!window.google?.maps?.importLibrary) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          const callback = '__gregleBusynessReady';
          let settled = false;
          const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            // Keep a harmless callback for an exceptionally late script response.
            window[callback] = () => {};
            if (error) { script.remove(); reject(error); } else resolve();
          };
          const timer = setTimeout(() => finish(Error('timeout')), 15000);
          window[callback] = () => finish();
          const url = new URL('https://maps.googleapis.com/maps/api/js');
          url.searchParams.set('key', config.browserKey);
          url.searchParams.set('v', 'weekly');
          url.searchParams.set('loading', 'async');
          url.searchParams.set('callback', callback);
          script.src = url.href; script.async = true;
          script.onerror = () => finish(Error('network'));
          document.head.append(script);
        });
      }
      let timeout;
      let places;
      try {
        places = await Promise.race([
          window.google.maps.importLibrary('places'),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('timeout')), 15000); }),
        ]);
      } finally { clearTimeout(timeout); }
      // Fail visibly if Google hasn't made this component available to the account/channel.
      if (!window.customElements.get('gmp-place-popular-times')) throw Error('unsupported');
      return places;
    })();
    try { return await library; }
    catch (error) { library = null; throw error; }
  }

  window.GregleMapBusyness = () => {
    const section = document.getElementById('place-busyness');
    if (!section || !core) return {select() {}};
    const status = document.getElementById('busyness-status');
    const content = document.getElementById('busyness-content');
    const button = document.getElementById('busyness-show');
    const back = document.getElementById('busyness-back');
    const fallback = document.getElementById('busyness-google-link');
    let current, key, version = 0, timer, paused = 0;
    try { paused = core.pauseUntil(sessionStorage.getItem(storageKey)); } catch {}

    const isCurrent = token => token === version && !!current;
    function stopPending() {
      clearTimeout(timer); timer = null;
      section.removeAttribute('aria-busy');
    }
    function message(text) { status.textContent = text; status.hidden = !text; }
    function pauseMessage() {
      message('Google could not load popular times. Its daily allowance may have been reached. Try again after midnight Pacific time, or open Google Maps.');
      button.hidden = true; back.hidden = true;
    }
    function denied(token) {
      if (!isCurrent(token)) return;
      stopPending(); content.replaceChildren();
      // gmp-error does not expose a reliable distinction between quota and key denials.
      // Do not mislabel authentication failures as a confirmed quota exhaustion.
      paused = core.nextReset();
      try { sessionStorage.setItem(storageKey, JSON.stringify({until: paused})); } catch {}
      pauseMessage();
      version++;
    }
    function watch(widget, token, onLoad) {
      stopPending(); section.setAttribute('aria-busy', 'true');
      timer = setTimeout(() => {
        if (!isCurrent(token)) return;
        stopPending(); content.replaceChildren(); back.hidden = true;
        button.hidden = false; button.disabled = false; button.textContent = 'Try popular times again';
        message('Google is taking too long to respond. Try again, or open Google Maps.');
        version++;
      }, 18000);
      widget.addEventListener('gmp-error', () => denied(token), {once: true});
      widget.addEventListener('gmp-load', () => {
        if (!isCurrent(token)) return;
        stopPending(); onLoad();
      }, {once: true});
    }
    function details(place) {
      if (!current || !place?.id || paused > Date.now()) return;
      const token = ++version;
      const widget = document.createElement('gmp-place-details');
      widget.className = 'busyness-widget';
      const request = document.createElement('gmp-place-details-place-request');
      request.place = place.id;
      const popular = document.createElement('gmp-place-popular-times');
      widget.append(request, document.createElement('gmp-place-name'), document.createElement('gmp-place-address'), popular);
      watch(widget, token, () => {
        if (popular.rendered === true) message('');
        else message('Google has no popular-times data for this business.');
      });
      message('Loading popular times…');
      button.hidden = true; back.hidden = false;
      content.replaceChildren(widget);
    }
    async function search() {
      if (!current || section.hasAttribute('aria-busy')) return;
      if (paused > Date.now()) { pauseMessage(); return; }
      paused = 0;
      const token = ++version;
      button.disabled = true; button.hidden = false; back.hidden = true;
      section.setAttribute('aria-busy', 'true');
      message('Finding this business on Google Maps…');
      try {
        await loadGoogle();
        if (!isCurrent(token)) return;
        const widget = document.createElement('gmp-place-search');
        widget.className = 'busyness-widget';
        widget.setAttribute('selectable', '');
        const request = document.createElement('gmp-place-text-search-request');
        request.setAttribute('max-result-count', '3');
        request.setAttribute('location-bias', `1000@${current.lat},${current.lng}`);
        request.setAttribute('text-query', core.query(current));
        const template = document.createElement('template');
        template.setAttribute('slot', 'details-item');
        template.content.append(document.createElement('gmp-place-name'), document.createElement('gmp-place-address'));
        widget.append(request, template);
        watch(widget, token, () => {
          if (!widget.places?.length) {
            message('No matching business was found on Google Maps.');
            button.hidden = false; button.disabled = false; button.textContent = 'Try popular times again';
            return;
          }
          message('Choose the matching business to see its popular times.');
        });
        widget.addEventListener('gmp-select', event => { if (isCurrent(token)) details(event.place); });
        button.hidden = true;
        content.replaceChildren(widget);
      } catch (error) {
        if (!isCurrent(token)) return;
        stopPending(); button.disabled = false; button.textContent = 'Try popular times again';
        message(error.message === 'unsupported' ? 'Google’s popular-times graph is not available here yet. You can check it on Google Maps.' : 'Popular times is unavailable right now. Try again, or open Google Maps.');
      }
    }
    button.addEventListener('click', () => { void search(); });
    back.addEventListener('click', () => { stopPending(); void search(); });

    return {select(place) {
      const nextKey = core.identity(place);
      if (nextKey && nextKey === key) {
        current = place; fallback.href = core.googleURL(place);
        if (paused && paused <= Date.now()) {
          paused = 0; button.hidden = false; button.disabled = false; button.textContent = 'Show popular times';
          message('See when this business is usually busiest.');
        }
        return;
      }
      version++; stopPending(); content.replaceChildren();
      current = nextKey ? place : null; key = nextKey;
      section.hidden = !current;
      button.disabled = false; button.hidden = false; button.textContent = 'Show popular times'; back.hidden = true;
      if (!current) return;
      fallback.href = core.googleURL(place);
      if (paused > Date.now()) pauseMessage();
      else message('See when this business is usually busiest.');
    }};
  };
})();
