/* framed — boot. */
(function (F) {
  function boot() {
    F.nav.init();
    // Settings → Start in = Art: a fresh launch (e.g. a remote button mapped to the app via the
    // daemon's app.launch rule) opens on the piece of art itself, not the launcher. Back still
    // reaches the launcher from there. An explicit #hash always wins.
    var prefs = F.store.get('settings', {});
    if (prefs.startScreen === 'art' && !location.hash) location.hash = '#/art';
    F.router.start();
    if (window.tizen) document.documentElement.setAttribute('data-runtime', 'tizen');
    console.info('[framed] ready · theme=' + document.documentElement.getAttribute('data-theme') + ' · bridge=' + window.__tvBridge.getState().platform);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.framed);
