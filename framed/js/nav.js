/*
 * framed — d-pad focus engine.
 *
 * Focus lives on elements marked [data-focusable] inside the current *scope* (the active
 * screen, or a modal panel). Arrow keys pick the geometrically nearest focusable in that
 * direction; Enter clicks; Back (Tizen 10009 / Backspace / Escape) bubbles to the router.
 * Elements with data-adjust="horizontal" consume Left/Right as a value change
 * (a 'framed:adjust' CustomEvent with detail.delta = ±1) instead of moving focus.
 */
window.framed = window.framed || {};
(function (F) {
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACKSPACE: 8, ESC: 27, TIZEN_RETURN: 10009, TIZEN_EXIT: 10182
  };
  var DIR = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  var scope = null;
  var lastFocused = null;
  var backHandler = null;
  var keyIntercept = null;
  var memory = []; // [{scope, el}] remembered focus per scope element

  function isVisible(el) {
    if (!el || el.hidden || el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
    if (!el.getClientRects().length) return false;
    var n = el;
    while (n && n !== document.body) {
      if (n.hidden) return false;
      n = n.parentElement;
    }
    return true;
  }

  function focusables(root) {
    root = root || scope || document;
    var list = root.querySelectorAll('[data-focusable]');
    var out = [];
    for (var i = 0; i < list.length; i++) if (isVisible(list[i])) out.push(list[i]);
    return out;
  }

  function remember(el) {
    if (!scope || !el) return;
    for (var i = 0; i < memory.length; i++) {
      if (memory[i].scope === scope) { memory[i].el = el; return; }
    }
    memory.push({ scope: scope, el: el });
  }
  function recall(sc) {
    for (var i = 0; i < memory.length; i++) if (memory[i].scope === sc) return memory[i].el;
    return null;
  }

  function focus(el, opts) {
    if (!el) return false;
    opts = opts || {};
    if (el.getAttribute('tabindex') == null) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (document.activeElement !== el) return false;
    // scrollIntoView on every d-pad step forces a layout + scroll pass on the TV's
    // WebKit and reads as input lag; only pay for it when the target is off-screen.
    if (!opts.noScroll && el.scrollIntoView) {
      var r = el.getBoundingClientRect();
      var off = r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
      if (off) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e2) { /* old engines */ }
      }
    }
    return true;
  }

  function focusFirst() {
    var list = focusables();
    return focus(list[0]);
  }

  function setScope(el, opts) {
    opts = opts || {};
    scope = el;
    var target = (opts.remember !== false && recall(el)) || opts.initial || null;
    if (!target || !isVisible(target) || !el.contains(target)) target = focusables(el)[0];
    if (target) focus(target);
    return target;
  }

  function current() {
    var a = document.activeElement;
    if (a && a !== document.body && scope && scope.contains(a) && a.hasAttribute('data-focusable')) return a;
    return null;
  }

  function rect(el) {
    var r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: r.width, h: r.height };
  }

  function pick(cur, dir) {
    var a = rect(cur);
    var cands = focusables();
    var best = null, bestScore = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c === cur) continue;
      var b = rect(c);
      var primary, offset, overlap;
      if (dir === 'left' || dir === 'right') {
        primary = dir === 'left' ? a.l - b.r : b.l - a.r;
        if (primary < -Math.min(a.w, b.w) * 0.5) continue;      // not actually in that direction
        if (dir === 'left' ? b.cx > a.cx : b.cx < a.cx) continue;
        overlap = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        offset = Math.abs(a.cy - b.cy);
      } else {
        primary = dir === 'up' ? a.t - b.b : b.t - a.b;
        if (primary < -Math.min(a.h, b.h) * 0.5) continue;
        if (dir === 'up' ? b.cy > a.cy : b.cy < a.cy) continue;
        overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        offset = Math.abs(a.cx - b.cx);
      }
      primary = Math.max(primary, 0);
      var score = primary + offset * 0.6 + (overlap > 0 ? 0 : 2000 + offset);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  function move(dir) {
    var cur = current();
    if (!cur) { focus(recall(scope)) || focusFirst(); return true; }
    var next = pick(cur, dir);
    if (next) { focus(next); return true; }
    return false; // edge — stay put (focus never lost)
  }

  function activate(el) {
    if (!el) return;
    el.classList.add('is-pressed');
    setTimeout(function () { el.classList.remove('is-pressed'); }, 120);
    el.click();
  }

  function isBackKey(e) {
    return e.keyCode === KEY.TIZEN_RETURN || e.keyCode === KEY.BACKSPACE || e.keyCode === KEY.ESC || e.key === 'XF86Back' || e.key === 'GoBack';
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (keyIntercept && keyIntercept(e) === true) { e.preventDefault(); return; }

    if (isBackKey(e)) {
      e.preventDefault();
      if (backHandler) backHandler();
      return;
    }
    var cur = current();
    if (e.keyCode === KEY.ENTER) {
      e.preventDefault();
      activate(cur || focusables()[0]);
      return;
    }
    var dir = DIR[e.keyCode];
    if (!dir) return;
    e.preventDefault();
    if (cur && cur.getAttribute('data-adjust') === 'horizontal' && (dir === 'left' || dir === 'right')) {
      cur.dispatchEvent(new CustomEvent('framed:adjust', { detail: { delta: dir === 'right' ? 1 : -1, fast: e.repeat }, bubbles: true }));
      return;
    }
    move(dir);
  }

  function onFocusIn(e) {
    var el = e.target;
    if (!(el instanceof Element) || !el.hasAttribute('data-focusable')) return;
    if (lastFocused && lastFocused !== el) lastFocused.classList.remove('is-focused');
    el.classList.add('is-focused');
    lastFocused = el;
    remember(el);
  }
  function onFocusOut(e) {
    var el = e.target;
    if (el instanceof Element) el.classList.remove('is-focused');
    // If focus fell to <body>, pull it back on the next tick so focus context is never lost.
    setTimeout(function () {
      if (document.activeElement === document.body || document.activeElement == null) {
        var back = recall(scope);
        if (back && isVisible(back)) focus(back, { noScroll: true }); else focusFirst();
      }
    }, 0);
  }

  // Pointer remotes / desktop mouse: hovering a focusable moves d-pad focus to it.
  function onPointerOver(e) {
    if (!document.body.classList.contains('has-pointer')) return; // ignore synthetic hover before any real pointer motion
    var el = e.target instanceof Element ? e.target.closest('[data-focusable]') : null;
    if (el && scope && scope.contains(el) && el !== document.activeElement) focus(el, { noScroll: true });
  }
  var pointerTimer;
  function onPointerMove() {
    document.body.classList.add('has-pointer');
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function () { document.body.classList.remove('has-pointer'); }, 3000);
  }

  function init() {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mouseover', onPointerOver);
    document.addEventListener('mousemove', onPointerMove);
    // Tizen: register additional remote keys we care about (optional; arrows/Enter/Return are default).
    try {
      if (window.tizen && tizen.tvinputdevice) {
        ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'ColorF0Red', 'ColorF1Green'].forEach(function (k) {
          try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* key not on this remote */ }
        });
      }
    } catch (e) { /* not Tizen */ }
  }

  F.nav = {
    KEY: KEY,
    init: init,
    setScope: setScope,
    focus: focus,
    focusFirst: focusFirst,
    focusables: focusables,
    move: move,
    current: current,
    onBack: function (fn) { backHandler = fn; },
    setKeyIntercept: function (fn) { keyIntercept = fn; },
    isBackKey: isBackKey
  };
})(window.framed);
