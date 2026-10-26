/* framed — Launcher screen: the home row. */
window.framed = window.framed || {};
(function (F) {
  /* ======== CONFIG — edit here ======== */
  // Tizen application id launched by the "Stream" tile. Requires the Moonlight Tizen
  // client (package MoonLightS, app MoonLightS.MoonlightWasm) installed on the TV —
  // install + Sunshine pairing steps are in README.md "Stream from PC".
  var GAMESTREAM_APP_ID = 'MoonLightS.MoonlightWasm';
  /* =================================== */
  var el = document.getElementById('screen-launcher');
  var clock = document.getElementById('mast-clock');
  var clockTimer;

  function tick() {
    var d = new Date();
    var hh = d.getHours(), mm = d.getMinutes();
    clock.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  el.addEventListener('click', function (e) {
    var tile = e.target instanceof Element ? e.target.closest('.tile') : null;
    if (!tile) return;
    var app = tile.getAttribute('data-app');
    if (tile.getAttribute('data-kind') === 'screen') F.router.go(app);
    else window.__tvBridge.launch(app === 'gamestream' ? GAMESTREAM_APP_ID : app);
  });

  F.router.register('launcher', {
    el: el,
    enter: function () {
      tick();
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 15000);
      F.nav.setScope(el);
    },
    leave: function () { clearInterval(clockTimer); },
    back: function () { return true; } // home: back does nothing
  });
})(window.framed);
