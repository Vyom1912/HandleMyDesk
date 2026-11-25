// Applies the saved light/dark theme before first paint so the page never flashes.
// A separate file (not inline) so the content security policy can forbid inline scripts.
(function () {
  // Settings saved under the previous product name move to the new names (theme, layout, session)
  [window.localStorage, window.sessionStorage].forEach(function (store) {
    try {
      for (var i = store.length - 1; i >= 0; i--) {
        var k = store.key(i);
        if (k && k.indexOf('novadesk_') === 0) {
          var next = 'handlemydesk_' + k.slice(9);
          if (store.getItem(next) === null) store.setItem(next, store.getItem(k));
          store.removeItem(k);
        }
      }
    } catch (e) {}
  });

  var pref = 'light';
  try {
    pref = localStorage.getItem('handlemydesk_theme') || 'light';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
