(() => {
  const toggle = document.getElementById('themeToggle');
  if (globalThis.GreglePreferences) {
    const preferences = globalThis.GreglePreferences;
    preferences.applyTheme();
    toggle?.addEventListener('click', () => preferences.setTheme(
      document.documentElement.classList.contains('dark-mode') ? 'light' : 'dark'));
    return;
  }
  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.classList.toggle('dark-mode', dark);
    toggle?.setAttribute('aria-checked', String(dark));
  }
  let saved;
  try { saved = localStorage.getItem('gregle-theme'); } catch (_) {}
  applyTheme(saved === 'dark' || saved === 'light' ? saved :
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  toggle?.addEventListener('click', () => {
    const theme = document.documentElement.classList.contains('dark-mode') ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('gregle-theme', theme); } catch (_) {}
  });
})();
