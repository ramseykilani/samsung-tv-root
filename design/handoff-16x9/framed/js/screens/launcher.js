/* framed — Launcher screen: the home row. */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-launcher');
  var clock = document.getElementById('mast-clock');
  var date = document.getElementById('mast-date');
  var artPreview = document.getElementById('home-art');
  var clockTimer;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function tick() {
    var d = new Date();
    var hh = d.getHours(), mm = d.getMinutes();
    clock.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    date.textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function paintArt() {
    // Settings → Home art: inside the TV's bezel (default) or the art alone
    artPreview.classList.toggle('home__art--tv', F.store.get('settings', {}).homeTv !== 'off');
    F.art.paintInto(document.getElementById('home-stage'), document.getElementById('home-frame'), document.getElementById('home-image'));
  }

  // the miniature brightens while Art is the focused app (the house lights come up on it)
  el.addEventListener('focusin', function (e) {
    var tile = e.target instanceof Element ? e.target.closest('.tile') : null;
    artPreview.classList.toggle('is-lit', !!tile && tile.getAttribute('data-app') === 'art');
  });
  window.addEventListener('resize', function () { if (!el.hidden) paintArt(); });

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
      paintArt();
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 15000);
      F.nav.setScope(el);
    },
    leave: function () { clearInterval(clockTimer); },
    back: function () { return true; } // home: back does nothing
  });
})(window.framed);
