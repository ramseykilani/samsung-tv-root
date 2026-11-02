/* framed — toast: one quiet line, bottom-centre, auto-dismiss. */
window.framed = window.framed || {};
(function (F) {
  var el, timer;
  function show(message, tone, ms) {
    el = el || document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.setAttribute('data-tone', tone || 'info');
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { el.hidden = true; }, ms || 2400);
  }
  F.toast = show;
  document.addEventListener('framed:toast', function (e) {
    show(e.detail.message, e.detail.tone, e.detail.ms);
  });
})(window.framed);
