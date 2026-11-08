/*
 * framed — hash router. #/launcher (default) · #/art · #/settings
 * A screen is { el, enter(), leave(), back() -> bool, onKey(e) -> bool }.
 * Back on the launcher does nothing (it IS home); back elsewhere returns to the launcher
 * unless the screen handled it (e.g. closing its settings panel).
 */
window.framed = window.framed || {};
(function (F) {
  var screens = {};
  var currentName = null;
  var HOME = 'launcher';

  function parse() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return screens[h] ? h : HOME;
  }

  function activate(name) {
    if (name === currentName) return;
    var prev = currentName ? screens[currentName] : null;
    var next = screens[name];
    if (prev) {
      if (prev.leave) prev.leave();
      prev.el.hidden = true;
    }
    currentName = name;
    next.el.hidden = false;
    // restart the arrival animation
    next.el.style.animation = 'none';
    void next.el.offsetWidth;
    next.el.style.animation = '';
    if (next.enter) next.enter();
    document.body.setAttribute('data-screen', name);
    if (F.brightness) F.brightness.refresh();
    F.nav.setKeyIntercept(next.onKey || null);
  }

  function go(name) {
    if (!screens[name]) name = HOME;
    var target = '#/' + name;
    if (location.hash === target) activate(name); else location.hash = target;
  }

  function back() {
    var cur = screens[currentName];
    if (cur && cur.back && cur.back() === true) return;
    if (currentName !== HOME) go(HOME);
  }

  function start() {
    window.addEventListener('hashchange', function () { activate(parse()); });
    F.nav.onBack(back);
    activate(parse());
  }

  F.router = {
    register: function (name, screen) { screens[name] = screen; },
    go: go,
    back: back,
    start: start,
    current: function () { return currentName; }
  };
})(window.framed);
