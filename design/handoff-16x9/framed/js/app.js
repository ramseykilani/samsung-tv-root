/* framed — boot. */
(function (F) {
  function boot() {
    F.nav.init();
    F.router.start();
    if (window.tizen) document.documentElement.setAttribute('data-runtime', 'tizen');
    console.info('[framed] ready · theme=' + document.documentElement.getAttribute('data-theme') + ' · bridge=' + window.__tvBridge.getState().platform);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.framed);
