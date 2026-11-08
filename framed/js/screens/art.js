/*
 * Art screen: flat frame styles, with Style and Colour remembered per picture.
 * The most recent look is the default for unset pictures. Existing frame records
 * migrate on read; slideshow, sensor dimming and remote library behavior stay here.
 * Frame geometry uses the supplied band widths in css/frames.css.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-art');
  var stage = document.getElementById('art-stage');
  var frame = document.getElementById('art-frame');
  var image = document.getElementById('art-image');
  var layers = [document.getElementById('art-layer-a'), document.getElementById('art-layer-b')];
  var corner = document.getElementById('art-corner');
  var panel = document.getElementById('art-panel');
  var picturesEl = document.getElementById('art-pictures');
  var controlsEl = document.getElementById('art-controls');

  // Frame geometry is real-world: the 55" Frame's screen is 679.9 mm tall. Each style's band width in
  // mm is written by the supplied frame design assets into css/frames.css as --band-mm and read back here.
  var SCREEN_MM_SHORT = 679.9;
  var SCREEN = 16 / 9;

  // The styles and their colours. Values must match the supplied frame design assets (it names the strips).
  function col(value, label) { return { value: value, label: label }; }
  var STYLES = [
    { value: 'none', label: 'None', colors: [] },
    { value: 'setin', label: 'Set in', colors: [col('black', 'Black')] },
    { value: 'gap', label: 'Shadow gap', colors: [col('black', 'Black'), col('charcoal', 'Charcoal')] },
    { value: 'thin', label: 'Thin frame', colors: [col('black', 'Black'), col('gold', 'Gold line'), col('silver', 'Silver line')] },
    { value: 'metal', label: 'Gallery metal', colors: [col('black', 'Black'), col('graphite', 'Graphite'), col('bronze', 'Bronze')] },
    { value: 'box', label: 'Shadowbox', colors: [col('grey', 'Light grey'), col('white', 'Warm white'), col('charcoal', 'Charcoal')] },
    { value: 'paper', label: 'Paper edge', colors: [col('white', 'Warm white'), col('cream', 'Cream'), col('grey', 'Grey'), col('black', 'Black')] },
    { value: 'linen', label: 'Linen', colors: [col('natural', 'Natural'), col('grey', 'Grey'), col('black', 'Black')] },
    { value: 'wood', label: 'Wood', colors: [col('walnut', 'Walnut'), col('oak', 'Oak'), col('ebony', 'Ebony')] }
  ];
  var DEFAULT = { style: 'thin', color: 'black' };

  function styleOf(v) { for (var i = 0; i < STYLES.length; i++) if (STYLES[i].value === v) return STYLES[i]; return null; }
  function hasColor(st, v) { for (var i = 0; i < st.colors.length; i++) if (st.colors[i].value === v) return true; return false; }
  // a valid colour for the style: the one asked for, else the one last chosen for it, else its first
  function colorFor(style, want, tones) {
    var st = styleOf(style);
    if (!st || !st.colors.length) return '';
    if (hasColor(st, want)) return want;
    if (tones && hasColor(st, tones[style])) return tones[style];
    return st.colors[0].value;
  }
  function look(style, color, tones) {
    if (!styleOf(style)) { style = DEFAULT.style; color = DEFAULT.color; }
    return { style: style, color: colorFor(style, color, tones) };
  }

  // Settings saved by earlier versions become a style: v0.1's four frames (frame: none | black | gold |
  // float, plus light: left | right), and before that a moulding x mount pair. Everything else is dropped.
  function fromOld(o) {
    if (o.moulding !== undefined || o.mount !== undefined) {
      if (o.moulding === 'none') return look('none');
      if (o.mount === 'fillet' || o.mount === 'bevel' || o.mount === 'goldline') return look('thin', 'gold');
      if (o.mount === 'float') return look('gap', 'black');
      return look('thin', 'black');
    }
    if (o.frame === 'none') return look('none');
    if (o.frame === 'gold') return look('thin', 'gold');
    if (o.frame === 'float') return look('gap', 'black');
    return look(DEFAULT.style, DEFAULT.color);
  }

  // Keep the repo's separate per-picture store and migrate each record on read.
  var DEFAULTS = { style: 'thin', color: 'black', drift: 'on' };
  function sanitize(o) {
    var next = styleOf(o.style) ? look(o.style, o.color) : fromOld(o);
    next.drift = o.drift === 'off' ? 'off' : DEFAULTS.drift;
    return next;
  }

  function mix() {
    var out = {}, i, k;
    for (i = 0; i < arguments.length; i++) {
      var o = arguments[i] || {};
      for (k in o) if (o.hasOwnProperty(k)) out[k] = o[k];
    }
    return out;
  }
  function globalLook() { return F.store.get('art', {}); }
  // stored settings from any version still get sanitized, per-picture or global
  function effective(id) {
    var per = F.store.get('artPer', {});
    return id && per[id] ? sanitize(per[id]) : sanitize(globalLook());
  }

  // Hourly drift, capped at six physical pixels per axis on a 3840 x 2160 panel.
  // Tizen may lay out at 1920 x 1080 and upscale, so convert from panel pixels
  // using the full screen's CSS dimensions (not devicePixelRatio or panel width).
  // Inset the stage by the same amount: the whole picture and frame stay on-screen
  // even at either extreme. The uncovered margin is the screen's bezel black.
  var DRIFT_MAX = 6;
  function driftAxis(h, salt) {
    var a = (h ^ salt) >>> 0;
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % (2 * DRIFT_MAX + 1) - DRIFT_MAX;
  }
  function applyDrift() {
    if (s.drift === 'off') {
      stage.style.top = stage.style.bottom = stage.style.left = stage.style.right = stage.style.transform = '';
      return;
    }
    var r = el.getBoundingClientRect();
    var scale = Math.min(r.width / 3840, r.height / 2160);
    var pad = DRIFT_MAX * scale;
    var h = Math.floor(Date.now() / 3600000);
    stage.style.top = stage.style.bottom = stage.style.left = pad + 'px';
    stage.style.right = panelOpen ? 'calc(var(--fr-panel-width) + ' + pad + 'px)' : pad + 'px';
    stage.style.transform = 'translate(' + (driftAxis(h, 0x9E3779B1) * scale) + 'px,' +
      (driftAxis(h, 0x85EBCA6B) * scale) + 'px)';
  }

  var s = effective(F.slideshow.current() && F.slideshow.current().id);
  F.store.set('art', sanitize(globalLook()));
  var api = null;
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var driftTimer = null;
  var libraryTimer = null;
  var picturesDirty = true;
  var driftHour = 0;
  var KEY = { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, PLAY_PAUSE: 179, TIZEN_PLAY_PAUSE: 10252 };

  // An edit dials in the current picture's own look AND becomes the default for
  // pictures that don't have their own yet; other pictures' memories are untouched.
  function save(patch) {
    s = sanitize(mix(s, patch));
    F.store.set('art', s);
    var item = F.slideshow.current();
    if (item) {
      var per = F.store.get('artPer', {});
      per[item.id] = s;
      F.store.set('artPer', per);
    }
  }

  function cssMM(el, name) {
    var v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return isNaN(v) ? 0 : v;
  }

  // Dress any stage (the Art screen, or the launcher's miniature) for the current picture.
  // The picture is 16:9 and as large as the stage allows; the band hugs it, the same width all round, so
  // it meets the stage's (screen's) edge at the top and bottom and the bezel's black shows for the few mm
  // left at the sides. With None the picture is the whole screen and nothing else is drawn.
  function dress(st, fr, eff) {
    var lk = eff || s;
    fr.setAttribute('data-style', lk.style);
    fr.setAttribute('data-color', lk.color);

    var r = st.getBoundingClientRect();
    if (!r.width || !r.height) return;   // not laid out (screen hidden): dressed again when shown
    var mm = Math.min(r.width, r.height) / SCREEN_MM_SHORT;
    var bw = lk.style === 'none' ? 0 : Math.max(1, Math.round(cssMM(fr, '--band-mm') * mm));
    st.style.setProperty('--mm', mm + 'px');
    st.style.setProperty('--bw', bw + 'px');

    // Whole px, and the same parity as the stage, so the centred picture's edges (and the band's
    // hairlines) sit on the pixel grid instead of blending half a pixel of the picture into the band.
    var h = Math.max(1, Math.floor(Math.min(r.height - 2 * bw, (r.width - 2 * bw) / SCREEN)));
    var w = Math.min(Math.round(h * SCREEN), Math.floor(r.width - 2 * bw));
    if ((Math.round(r.height) - h) % 2) h -= 1;
    if ((Math.round(r.width) - w) % 2) w -= 1;
    fr.style.width = w + 'px';
    fr.style.height = h + 'px';
  }

  // Dimming and sensor-driven RGB gains affect only the art stage. The settings
  // panel remains readable. Manual dimming no longer adds a synthetic sepia ramp.
  function applyDim() {
    F.adaptive.apply();
  }
  function setting(key, fallback) {
    var v = F.store.get('settings', {})[key];
    return v === undefined ? fallback : v;
  }
  function brightness() {
    var b = setting('brightness', 100);
    return typeof b === 'number' ? Math.max(0, Math.min(100, b)) : 100;
  }
  applyDim();
  window.addEventListener('framed:settings', applyDim);

  // (Re)apply state: load the current picture's own look (or the default), repaint, resync panel.
  function apply() {
    var item = F.slideshow.current();
    s = effective(item && item.id);
    showPicture(item);
    layout();
    syncPanel();
  }

  // When the picture changes (slideshow tick, the picture grid), every settings row must show the new
  // picture's own look — not the previous picture's values. Runs whether or not the panel is open.
  function syncPanel() {
    if (!api) return;
    if (api.get('style') !== s.style) buildControls();
    api.set('style', s.style);
    api.set('color', s.color);
    api.set('drift', s.drift);
  }

  // Paint the picture on the inactive layer, then flip — the opacity transition is --fr-motion-art.
  function showPicture(item) {
    markCurrent();
    if (!item) return;
    image.setAttribute('aria-label', item.title);
    if (item.src === shownSrc) return;
    shownSrc = item.src;
    var img = new Image();
    img.onload = function () {
      if (shownSrc !== item.src) return; // superseded by a faster advance
      var nextLayer = layers[1 - active];
      nextLayer.style.backgroundImage = 'url("' + item.src + '")';
      nextLayer.setAttribute('data-active', 'true');
      layers[active].setAttribute('data-active', 'false');
      active = 1 - active;
    };
    img.src = item.src;
  }

  function everyLabel(v) {
    var c = F.slideshow.get().cadence;
    return v + ' ' + (c === 'days' ? (v === 1 ? 'day' : 'days') : (v === 1 ? 'hour' : 'hours'));
  }

  function layout() { applyDrift(); dress(stage, frame, s); }

  // ---- the picture grid: every library picture as a thumbnail cropped as the screen will show it ----
  function buildPictures() {
    if (!picturesDirty) return;
    picturesDirty = false;
    var list = F.library.list();
    picturesEl.innerHTML = '';
    picturesEl.hidden = !list.length;
    list.forEach(function (item, i) {
      var b = document.createElement('button');
      b.className = 'pick';
      b.setAttribute('data-focusable', '');
      b.setAttribute('tabindex', '-1');
      b.setAttribute('data-id', item.id);
      b.setAttribute('aria-label', item.title);
      var img = document.createElement('img');
      img.className = 'pick__img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = item.src;
      b.appendChild(img);
      b.addEventListener('click', function () {
        F.slideshow.goTo(F.slideshow.sequence().indexOf(i));
      });
      picturesEl.appendChild(b);
    });
    markCurrent();
  }

  function currentPick() {
    var item = F.slideshow.current();
    return item ? picturesEl.querySelector('.pick[data-id="' + String(item.id).replace(/"/g, '\\"') + '"]') : null;
  }

  function markCurrent() {
    if (!picturesEl) return;
    var cur = currentPick();
    var picks = picturesEl.querySelectorAll('.pick');
    for (var i = 0; i < picks.length; i++) picks[i].setAttribute('aria-current', String(picks[i] === cur));
  }

  function showChrome(ms) {
    el.classList.add('show-chrome');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(function () { el.classList.remove('show-chrome'); }, ms || 2500);
  }

  function openPanel() {
    if (panelOpen) return;
    buildPictures();
    panelOpen = true;
    panel.hidden = false;
    el.classList.add('panel-open');
    markCurrent();
    F.nav.setScope(panel, { remember: false, initial: currentPick() });
    layout();
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.hidden = true;
    el.classList.remove('panel-open');
    F.nav.setScope(el, { initial: corner });
    showChrome(1800);
    layout();
  }

  function buildControls() {
    var ss = F.slideshow.get();
    var st = styleOf(s.style);
    var specs = [
      { id: 'cadence', name: 'Slideshow', type: 'choice', value: ss.cadence, options: F.slideshow.CADENCES },
      { id: 'every', name: 'Every', type: 'range', value: ss.every, min: 1, max: F.slideshow.everyMax(ss), step: 1, hidden: ss.cadence === 'off', format: everyLabel },
      { id: 'order', name: 'Order', type: 'choice', value: ss.order, options: F.slideshow.ORDERS },
      { id: 'startScreen', name: 'Start in', type: 'choice', value: setting('startScreen', 'launcher'), options: [
        { value: 'launcher', label: 'Launcher' }, { value: 'art', label: 'Art' }],
        help: 'Which screen a fresh framed launch opens on' },
      { id: 'brightness', name: 'Brightness', type: 'range', value: brightness(), min: 0, max: 100, step: 1, fastStep: 5,
        hidden: setting('adaptiveBrightness', 'on') === 'on',
        format: function (v) { return v + '%'; },
        help: 'Software dimming; 0 is near-black, below the panel minimum' },
      { id: 'artFloor', name: 'Art floor', type: 'range', value: setting('artFloor', 10), min: 0, max: 100, step: 1, fastStep: 5,
        format: function (v) { return v + '%'; },
        help: 'The darkest level dimming may reach' },
      { id: 'adaptiveBrightness', name: 'Adaptive brightness', type: 'choice', value: setting('adaptiveBrightness', 'on'), options: [
        { value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
        help: 'Sensor dims the art with the room; Off shows a manual slider' },
      { id: 'adaptiveTone', name: 'Adaptive tone', type: 'choice', value: setting('adaptiveTone', 'on'), options: [
        { value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
      { id: 'style', name: 'Style', type: 'choice', value: s.style, options: STYLES },
      { id: 'color', name: 'Colour', type: 'choice', value: s.color, options: st.colors, hidden: st.colors.length < 2 },
      { id: 'drift', name: 'Pixel shift', type: 'choice', value: s.drift, options: [
        { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
        help: 'Shifts up to 6 pixels on a 4K screen each hour; a small margin keeps the whole picture visible' },
      { id: 'reset', name: 'Reset', type: 'action' }
    ];
    api = F.controls.render(controlsEl, specs, function (id, value) {
      if (id === 'reset') {
        var per = F.store.get('artPer', {});
        var cur = F.slideshow.current();
        if (cur && per[cur.id]) { delete per[cur.id]; F.store.set('artPer', per); }
        s = sanitize(mix(DEFAULTS));
        F.store.set('art', s);
        F.slideshow.set({ cadence: F.slideshow.DEFAULTS.cadence, every: F.slideshow.DEFAULTS.every, order: F.slideshow.DEFAULTS.order });
        buildControls();
        F.nav.setScope(panel, { remember: false, initial: api.el('reset') });
        F.toast('Reset', 'ok');
      } else if (id === 'cadence') {
        F.slideshow.set({ cadence: value });
        buildControls();   // the Every row hides on Off and re-ranges to the unit
      } else if (id === 'every' || id === 'order') {
        var sp = {}; sp[id] = value; F.slideshow.set(sp);
      } else if (id === 'adaptiveBrightness' || id === 'adaptiveTone') {
        var adaptivePatch = {}; adaptivePatch[id] = value;
        F.store.merge('settings', adaptivePatch, {});
        window.dispatchEvent(new CustomEvent('framed:settings'));
        if (id === 'adaptiveBrightness') buildControls();
      } else if (id === 'brightness') {
        F.store.merge('settings', { brightness: value }, {});
        window.__tvBridge.setBrightness(value);
        window.dispatchEvent(new CustomEvent('framed:settings'));
      } else if (id === 'artFloor') {
        F.store.merge('settings', { artFloor: value }, {});
        window.__tvBridge.setArtFloor(value);
        window.dispatchEvent(new CustomEvent('framed:settings'));
      } else if (id === 'startScreen') {
        F.store.merge('settings', { startScreen: value }, {});
      } else {
        var patch = {}; patch[id] = value;
        var tones = F.store.get('artTones', {});
        if (id === 'style') patch.color = colorFor(value, null, tones);
        save(patch);
        if (s.color) { tones[s.style] = s.color; F.store.set('artTones', tones); }
        if (id === 'style') buildControls();
      }
      apply();
    });
  }

  // The launcher's miniature uses the same renderer, painting the current picture directly
  // in that picture's own remembered look.
  F.art = {
    styles: function () { return JSON.parse(JSON.stringify(STYLES)); },
    paintInto: function (st, fr, im) {
      var item = F.slideshow.current();
      if (!item) return;
      im.style.backgroundImage = 'url("' + item.src + '")';
      dress(st, fr, effective(item.id));
    }
  };

  // the sequencer advanced (timer, catch-up, manual, or from the Settings screen)
  F.slideshow.subscribe(function () { if (!el.hidden) apply(); });
  // library swapped at runtime (remote manifest arrived): rebuild the picture grid
  window.addEventListener('framed:library', function () {
    picturesDirty = true;
    if (panelOpen) {
      buildPictures();
      F.nav.setScope(panel, { remember: false, initial: currentPick() });
    }
    if (!el.hidden) apply();
  });

  corner.addEventListener('click', openPanel);
  window.addEventListener('resize', layout);

  F.router.register('art', {
    el: el,
    enter: function () {
      F.adaptive.start();
      F.slideshow.start();   // catch up on elapsed periods and tick while art is shown
      apply();               // load this picture's own look first — the panel rows are built from it
      buildControls();
      driftHour = Math.floor(Date.now() / 3600000);
      clearInterval(driftTimer);
      driftTimer = setInterval(function () {
        var h = Math.floor(Date.now() / 3600000);
        if (h !== driftHour) { driftHour = h; applyDrift(); }
      }, 60000);
      F.nav.setScope(el, { initial: corner, remember: false });
      showChrome(3000);
      // pick up pictures dropped in the remote folder since boot: refetch the
      // manifest now and once a minute while art is showing
      F.library.reload();
      clearInterval(libraryTimer);
      libraryTimer = setInterval(function () { F.library.reload(); }, 60000);
    },
    leave: function () { F.adaptive.stop(); F.slideshow.pause(); closePanel(); clearTimeout(chromeTimer); clearInterval(driftTimer); clearInterval(libraryTimer); },
    back: function () {
      if (panelOpen) { closePanel(); return true; }
      return false;
    },
    onKey: function (e) {
      if (e.key === 's' || e.key === 'S') { panelOpen ? closePanel() : openPanel(); return true; }
      if (panelOpen) return false;
      if (e.keyCode === KEY.RIGHT) { F.slideshow.next(); return true; }
      if (e.keyCode === KEY.LEFT) { F.slideshow.prev(); return true; }
      if (e.key === 'p' || e.key === 'P' || e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.TIZEN_PLAY_PAUSE) {
        var c = F.slideshow.toggle();
        F.toast(c === 'off' ? 'Slideshow off' : 'Slideshow: ' + F.slideshow.cadenceLabel(F.slideshow.get()), 'info');
        return true;
      }
      if (e.keyCode === KEY.UP || e.keyCode === KEY.DOWN) {
        showChrome(2500); // reveal the corner affordance
        return false;
      }
      return false;
    }
  });
})(window.framed);
