/* App-only software dimming. Art has its own independent adaptive pipeline.
 * A black layer also covers native video beneath the web view; verify on TV.
 * This does not change panel backlight or the brightness of external apps. */
(function (F) {
  var veil = document.getElementById('brightness-veil');
  var hud = document.getElementById('brightness-hud');
  var fill = document.getElementById('brightness-fill');
  var value = document.getElementById('brightness-value');
  var timer, lastStep = 0;
  function level() {
    var n = F.store.get('settings', {}).appBrightness;
    return typeof n === 'number' && isFinite(n) ? Math.max(5, Math.min(100, Math.round(n))) : 100;
  }
  function hide() { clearTimeout(timer); hud.hidden = true; }
  function refresh() {
    hide();
    lastStep = 0;
    veil.style.opacity = F.router.current() === 'art' ? '0' : String(1 - level() / 100);
  }
  function show(n) {
    value.textContent = n + '%';
    fill.style.width = n + '%';
    hud.setAttribute('aria-valuenow', n);
    hud.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, 2000);
  }
  function onKey(e) {
    // Tizen TVInputDevice codes, not Linux evdev codes or colour keys 403/404.
    var delta = e.key === 'ChannelUp' || e.keyCode === 427 ? 5 :
      e.key === 'ChannelDown' || e.keyCode === 428 ? -5 : 0;
    if (!delta) return false;
    if (F.router.current() === 'art') {
      F.toast('Art uses its own brightness settings');
      return true;
    }
    var now = Date.now(), n = level();
    // Bound held-button repeat speed without dropping separate presses.
    if (!e.repeat || now - lastStep >= 100) {
      n = Math.max(5, Math.min(100, n + delta));
      F.store.merge('settings', { appBrightness: n }, {});
      veil.style.opacity = String(1 - n / 100);
      lastStep = now;
    }
    show(n);
    return true;
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) hide(); });
  F.brightness = { onKey: onKey, refresh: refresh };
})(window.framed);
