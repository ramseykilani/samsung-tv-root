/* framed — Launcher screen: the home row. */
window.framed = window.framed || {};
(function (F) {
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
    else window.__tvBridge.launch(app);
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
