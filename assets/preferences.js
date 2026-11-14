(function (win) {
  'use strict';
  if (win.GreglePreferences) return;
  const doc = win.document;
  const keys = {theme: 'gregle-theme', order: 'gregle-app-order'};
  const subscribers = new Set();
  const appearance = win.matchMedia?.('(prefers-color-scheme: dark)');
  const validTheme = value => value === 'dark' || value === 'light' ? value : null;
  function validOrder(value) {
    if (!Array.isArray(value) || value.length > 32) return null;
    const order = [...new Set(value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 160))];
    return order.length ? order : null;
  }
  function local(key) {
    try { return win.localStorage.getItem(key); } catch { return null; }
  }
  function mirror(key, value) {
    try { if (local(key) !== value) win.localStorage.setItem(key, value); } catch {}
  }
  function cookie(key) {
    try {
      const entry = String(doc.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(key + '='));
      return entry ? decodeURIComponent(entry.slice(key.length + 1)) : null;
    } catch { return null; }
  }
  function share(key, value) {
    try {
      const host = win.location?.hostname || '';
      const domain = host === 'gregle.uk' || host.endsWith('.gregle.uk') ? '; Domain=gregle.uk' : '';
      const secure = win.location?.protocol === 'https:' ? '; Secure' : '';
      doc.cookie = key + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=31536000; SameSite=Lax' + domain + secure;
    } catch {}
  }
  function parseOrder(value) {
    try { return validOrder(JSON.parse(value)); } catch { return null; }
  }
  function read(kind, migrate = false) {
    const key = keys[kind], validate = kind === 'theme' ? validTheme : parseOrder;
    const shared = validate(cookie(key));
    const value = shared || validate(local(key));
    if (value) {
      const encoded = kind === 'order' ? JSON.stringify(value) : value;
      mirror(key, encoded);
      // Adopt a pre-existing device preference only when no shared choice exists.
      if (!shared && migrate) share(key, encoded);
    }
    return value;
  }
  let theme = read('theme', true), order = read('order', true);
  function applyTheme() {
    const dark = (theme || (appearance?.matches ? 'dark' : 'light')) === 'dark';
    doc.documentElement.classList.toggle('dark-mode', dark);
    doc.body?.classList.toggle('dark-mode', dark);
    doc.getElementById('themeToggle')?.setAttribute('aria-checked', String(dark));
    doc.getElementById('brandThemeToggle')?.setAttribute('aria-pressed', String(dark));
  }
  function notify() {
    applyTheme();
    for (const listener of subscribers) listener();
  }
  function refresh() {
    const nextTheme = read('theme') || theme, nextOrder = read('order') || order;
    if (nextTheme === theme && JSON.stringify(nextOrder) === JSON.stringify(order)) return;
    theme = nextTheme; order = nextOrder; notify();
  }
  win.GreglePreferences = {
    getTheme: () => theme,
    getOrder: () => order ? [...order] : null,
    applyTheme, refresh,
    setTheme(value) {
      if (!validTheme(value)) return;
      theme = value; mirror(keys.theme, value); share(keys.theme, value); notify();
    },
    setOrder(value) {
      const next = validOrder(value);
      if (!next) return;
      order = next;
      const encoded = JSON.stringify(order);
      mirror(keys.order, encoded); share(keys.order, encoded); notify();
    },
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }
  };
  applyTheme();
  doc.addEventListener('DOMContentLoaded', applyTheme);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { refresh(); applyTheme(); } });
  win.addEventListener('focus', refresh);
  win.addEventListener('pageshow', () => { refresh(); applyTheme(); });
  win.addEventListener('storage', event => { if (Object.values(keys).includes(event.key)) refresh(); });
  // Cookies are shared by sibling subdomains, whose localStorage events are isolated.
  // Poll only visible pages; focus/pageshow also catch changes after suspension.
  win.setInterval(() => { if (!doc.hidden) refresh(); }, 2000);
  const followDevice = () => { if (!theme) applyTheme(); };
  if (appearance?.addEventListener) appearance.addEventListener('change', followDevice);
  else appearance?.addListener?.(followDevice);
})(window);
