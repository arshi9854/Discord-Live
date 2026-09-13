// Loaded before styles to avoid flashing the wrong saved theme. No credentials here.
(() => {
  let saved;
  try { saved = localStorage.getItem('pocket-post:theme'); } catch { /* Storage can be unavailable. */ }
  let theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#fafbf8' : '#101412';
    const button = document.getElementById('theme-toggle');
    if (button) { button.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark'; button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`); }
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark'; apply();
      try { localStorage.setItem('pocket-post:theme', theme); } catch { /* Works for this visit. */ }
    });
  });
})();
