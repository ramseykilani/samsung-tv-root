/*
 * framed — Art screen. The picture fills the screen, in a thin drawn frame (lit from the chosen side) that
 * continues the TV's own black bezel, so the whole TV reads as one picture frame. Pictures are 16:9
 * (js/library.js refuses any other shape), and the frame hugs the whole picture: it is the same width all
 * round and its opening is 16:9 too, so nothing of the picture is ever hidden. The few mm left over at the
 * sides are the bezel's black, which the frame's flat black face continues. No mat, no caption.
 * The slideshow sequencer (js/slideshow.js) decides which library picture is current.
 * No chrome while art is shown; the corner affordance (or the `s` key) opens the settings panel, which
 * opens on a grid of the library's pictures. While the panel is closed: Left/Right = previous/next
 * picture, `p` / MediaPlayPause = slideshow on/off. Frame settings persist under "framed.art" (the default
 * look) and per picture under "framed.artPer": editing dials in the current picture's own look, which
 * wins on every revisit; pictures without their own memory inherit the most recent look.
 * Slideshow prefs: "framed.slideshow". Rendering of mouldings and liners lives in css/frames.css; this
 * file sets their geometry.
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

  // Frame geometry is real-world: the 55" Frame's screen is 679.9 mm tall, so one hundredth of the
  // stage's shorter edge (u) is 6.799 mm. Each moulding and liner has a nominal width in mm, written
  // by tools/gen_frames.py into css/frames.css as --m-mm / --l-mm and read back here.
  var MM_PER_U = 6.799;
  var SCREEN = 16 / 9;
  // The four frames: the slim family of tools/slim_frames.py, as in the Art Mode pictures. Each is a
  // moulding × liner pair rendered by css/frames.css.
  var FRAMES = [
    { value: 'none', label: 'None', moulding: 'none', mount: 'flat' },
    { value: 'black', label: 'Black', moulding: 'bezel', mount: 'flat' },
    { value: 'gold', label: 'Black and gold', moulding: 'bezel', mount: 'goldline' },
    { value: 'float', label: 'Floating', moulding: 'bezelfloat', mount: 'float' }];
  // settings from earlier versions that no longer exist (the mat, contain fit, caption, wide mouldings)
  var DROPPED = ['profile', 'fit', 'matte', 'matteBottom', 'matteColor', 'customHue', 'customSat', 'customLight',
    'label', 'moulding', 'mount', 'frameWeight'];

  var DEFAULTS = {
    frame: 'black',
    light: 'left',
    drift: 'on'
  };

  function frameOf(v) { for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].value === v) return FRAMES[i]; return null; }
  // stored settings from any version: an old moulding × liner becomes the nearest of the four frames
  // (checked first: the merge with DEFAULTS has already given an old record a frame)
  function sanitize(o) {
    if (o.moulding !== undefined || !frameOf(o.frame)) {
      o.frame = o.moulding === 'none' ? 'none'
        : o.mount === 'fillet' || o.mount === 'bevel' ? 'gold'
        : o.mount === 'float' ? 'float'
        : DEFAULTS.frame;
    }
    if (o.light !== 'left' && o.light !== 'right') o.light = DEFAULTS.light;
    if (o.drift !== 'on' && o.drift !== 'off') o.drift = DEFAULTS.drift;
    DROPPED.forEach(function (k) { delete o[k]; });
    return o;
  }

  function mix() {
    var out = {}, i, k;
    for (i = 0; i < arguments.length; i++) {
      var o = arguments[i] || {};
      for (k in o) if (o.hasOwnProperty(k)) out[k] = o[k];
    }
    return out;
  }
  function globalLook() { return mix(DEFAULTS, F.store.get('art', {})); }
  // stored settings from any version still get sanitized, per-picture or global
  function effective(id) {
    var per = F.store.get('artPer', {});
    return id && per[id] ? sanitize(mix(DEFAULTS, per[id])) : sanitize(globalLook());
  }

  // Anti-burn-in drift: the whole stage is oversized by DRIFT_MAX px on every side and nudged
  // within that overscan once per hour, so the art shifts a few pixels without ever revealing
  // an edge — the same idea as Samsung's periodic image shift, derived from the hour-of-epoch
  // so it survives reloads and needs no stored state.
  var DRIFT_MAX = 10; // logical px each way (~20 px on the 4K panel)
  // Overscan must exceed the drift: at a maximum nudge the stage edge would land exactly on the
  // screen edge, and subpixel rounding on the TV exposes a sliver of the wall behind it — most
  // visible with no mat, where nothing else cushions the seam. Extra margin keeps it off-screen.
  var DRIFT_PAD = DRIFT_MAX + 6;
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
    var h = Math.floor(Date.now() / 3600000);
    stage.style.top = -DRIFT_PAD + 'px';
    stage.style.bottom = -DRIFT_PAD + 'px';
    stage.style.left = -DRIFT_PAD + 'px';
    stage.style.right = panelOpen ? '' : -DRIFT_PAD + 'px'; // while the panel is open, CSS owns right
    stage.style.transform = 'translate(' + driftAxis(h, 0x9E3779B1) + 'px,' + driftAxis(h, 0x85EBCA6B) + 'px)';
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

  // Dress any stage (the Art screen, or the launcher's miniature) in the given look.
  // The picture is 16:9 and as large as the stage allows; the liner and moulding hug it, the same width
  // all round, so the moulding meets the stage's (screen's) edge at the top and bottom and the bezel's
  // black shows for the few mm left at the sides. With no frame the picture is the whole screen.
  function dress(st, fr, eff) {
    eff = eff || s;
    var f = frameOf(eff.frame);
    fr.setAttribute('data-mount', f.mount);
    fr.setAttribute('data-moulding', f.moulding);
    fr.setAttribute('data-light', eff.light);

    var r = st.getBoundingClientRect();
    var u = Math.min(r.width, r.height) / 100;
    var mm = u / MM_PER_U;
    var framed = f.moulding !== 'none';
    var mw = framed ? cssMM(fr, '--l-mm') * mm : 0;
    var fw = framed ? cssMM(fr, '--m-mm') * mm : 0;
    var t = fw + mw;

    st.setAttribute('data-framed', String(framed));
    st.style.setProperty('--u', u + 'px');
    st.style.setProperty('--mm', mm + 'px');
    st.style.setProperty('--mw', mw + 'px');
    st.style.setProperty('--fw', fw + 'px');
    st.style.setProperty('--lx', eff.light === 'right' ? -1 : 1);

    var h = Math.max(1, Math.min(r.height - 2 * t, (r.width - 2 * t) / SCREEN)), w = h * SCREEN;
    fr.style.width = w + 'px';
    fr.style.height = h + 'px';

    // the moulding's outer edge, measured from the picture's edge: the same all round
    ['--ft', '--fb', '--fl', '--fr'].forEach(function (k) { st.style.setProperty(k, t + 'px'); });
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
  var SYNC_IDS = ['frame', 'light', 'drift'];
  function syncPanel() {
    if (!api) return;
    for (var i = 0; i < SYNC_IDS.length; i++) api.set(SYNC_IDS[i], s[SYNC_IDS[i]]);
    api.setHidden('light', s.frame === 'none');
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

  function layout() { dress(stage, frame, s); applyDrift(); }

  // ---- the picture grid: every library picture as a thumbnail cropped as the screen will show it ----
  function buildPictures() {
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
    var none = s.frame === 'none';
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
      { id: 'frame', name: 'Frame', type: 'choice', value: s.frame, options: FRAMES },
      { id: 'light', name: 'Light from', type: 'choice', value: s.light, hidden: none, options: [
        { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
      { id: 'drift', name: 'Pixel shift', type: 'choice', value: s.drift, options: [
        { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
        help: 'Nudges the art a few pixels each hour against burn-in' },
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
        var patch = {}; patch[id] = value; save(patch);
        if (id === 'frame') api.setHidden('light', value === 'none');
      }
      apply();
    });
  }

  // The launcher's miniature uses the same renderer, painting the current picture directly
  // in that picture's own remembered look.
  F.art = {
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
  window.addEventListener('framed:library', function () { if (!el.hidden) { buildPictures(); apply(); } });

  corner.addEventListener('click', openPanel);
  window.addEventListener('resize', layout);

  F.router.register('art', {
    el: el,
    enter: function () {
      F.adaptive.start();
      F.slideshow.start();   // catch up on elapsed periods and tick while art is shown
      buildPictures();
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
