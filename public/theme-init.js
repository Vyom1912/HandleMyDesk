// Applies the saved light/dark theme before first paint so the page never flashes.
// A separate file (not inline) so the content security policy can forbid inline scripts.
(function () {
  var pref = 'light';
  try {
    pref = localStorage.getItem('novadesk_theme') || 'light';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
