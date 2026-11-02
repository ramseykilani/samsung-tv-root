/*
 * framed — Art screen. Fullscreen picture in a drawn frame (moulding × liner, lit from the chosen side)
 * with an optional mat; the slideshow sequencer (js/slideshow.js) decides which library picture is current.
 * No chrome while art is shown; the corner affordance (or the `s` key) opens the settings panel.
 * While the panel is closed: Left/Right = previous/next picture, `p` / MediaPlayPause = slideshow
 * on/off. Frame/matte settings persist under "framed.art" (the default look) and per picture under
 * "framed.artPer": editing dials in the current picture's own look, which wins on every revisit;
 * pictures without their own memory inherit the most recent look. Slideshow prefs: "framed.slideshow".
 * Rendering of mounts and mouldings lives in css/frames.css; this file sets their geometry.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-art');
  var stage = document.getElementById('art-stage');
  var frame = document.getElementById('art-frame');
  var image = document.getElementById('art-image');
  var layers = [document.getElementById('art-layer-a'), document.getElementById('art-layer-b')];
  var label = document.getElementById('art-label');
  var labelTitle = document.getElementById('art-label-title');
  var labelMeta = document.getElementById('art-label-meta');
  var corner = document.getElementById('art-corner');
  var panel = document.getElementById('art-panel');
  var panelStatus = document.getElementById('art-panel-status');
  var controlsEl = document.getElementById('art-controls');

  // 8 matte presets + custom, light to dark. Mhach's bone and stone, kept quiet enough to sit
  // behind any work; Black is lifted a hair off #000 for the panel, still black in a dark room.
  var MATTES = [
    { value: 'paper', label: 'Paper', color: '#EDEAE1' },
    { value: 'bone', label: 'Bone', color: '#E0DFD7' },
    { value: 'salt', label: 'Salt', color: '#C9CCC4' },
    { value: 'lichen', label: 'Lichen', color: '#8E9A93' },
    { value: 'stone', label: 'Stone', color: '#3A4548' },
    { value: 'moor', label: 'Moor', color: '#242F32' },
    { value: 'deep', label: 'Deep water', color: '#12191C' },
    { value: 'black', label: 'Black', color: '#070909' },
    { value: 'custom', label: 'Custom' }
  ];

  // Frame geometry is real-world: the 55" Frame's screen is 679.9 mm tall, so one hundredth of the
  // stage's shorter edge (u) is 6.799 mm. Each moulding and liner has a nominal width in mm, written
  // by tools/gen_frames.py into css/frames.css as --m-mm / --l-mm and read back here.
  var MM_PER_U = 6.799;
  var BEVEL_MM = 4.5;   // a mat's bevel cut (no bitmap; see css/frames.css)
  // Contain inside a moulding: a picture whose shape differs from the screen's gets at least this
  // much mat all round (in u), so it never touches the frame on two sides only, which no framer would do
  var CONTAIN_MIN_MAT = 6;
  // Frame width steps 1–10 scale the moulding's nominal width; 5 is the moulding as made.
  var WIDTH_SCALE = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
  var MOULDINGS = [
    { value: 'none', label: 'None' }, { value: 'walnut', label: 'Walnut' }, { value: 'gilt', label: 'Gilt' },
    { value: 'ebony', label: 'Ebony' }, { value: 'black', label: 'Black' }];
  var MOUNTS = [
    { value: 'flat', label: 'None' }, { value: 'fillet', label: 'Gold fillet' }, { value: 'linen', label: 'Linen' },
    { value: 'slip', label: 'Black slip' }, { value: 'bevel', label: 'Mat bevel' }, { value: 'float', label: 'Float' }];
  // values from earlier versions -> their nearest surviving design
  var RETIRED = { oak: 'walnut', silver: 'gilt', white: 'black', double: 'bevel', shadowbox: 'bevel' };

  // The owner's look: no mat, the picture fills the screen, and a walnut moulding with a gold
  // fillet at the screen's edge, inside the TV's own black bezel.
  var DEFAULTS = {
    fit: 'cover',
    matte: 0,
    matteBottom: 0,
    matteColor: 'paper',
    customHue: 30,
    customSat: 20,
    customLight: 85,
    mount: 'fillet',
    moulding: 'walnut',
    frameWeight: 5,
    light: 'left',
    label: 'off',
    drift: 'on'
  };

  function has(list, v) { for (var i = 0; i < list.length; i++) if (list[i].value === v) return true; return false; }
  // stored settings from any version: unknown values fall back, retired ones map to their successor
  function sanitize(o) {
    if (!has(MOULDINGS, o.moulding)) o.moulding = RETIRED[o.moulding] || DEFAULTS.moulding;
    if (!has(MOUNTS, o.mount)) o.mount = RETIRED[o.mount] || DEFAULTS.mount;
    if (o.light !== 'left' && o.light !== 'right') o.light = DEFAULTS.light;
    if (o.fit !== 'contain' && o.fit !== 'cover') o.fit = DEFAULTS.fit;
    if (o.drift !== 'on' && o.drift !== 'off') o.drift = DEFAULTS.drift;
    var w = Math.round(Number(o.frameWeight));
    o.frameWeight = w >= 1 && w <= 10 ? w : DEFAULTS.frameWeight;
    if (!(Number(o.matte) >= 0)) o.matte = DEFAULTS.matte;
    if (!(Number(o.matteBottom) >= 0)) o.matteBottom = DEFAULTS.matteBottom;
    delete o.profile; // retired: each moulding now has its own profile
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
  var natural = { w: 3, h: 2 };
  var naturals = {};         // src -> { w, h }, for the launcher's miniature
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var driftTimer = null;
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

  function matteHex(eff) {
    eff = eff || s;
    if (eff.matteColor === 'custom') return hsl(eff.customHue, eff.customSat, eff.customLight);
    for (var i = 0; i < MATTES.length; i++) if (MATTES[i].value === eff.matteColor) return MATTES[i].color;
    return MATTES[0].color;
  }
  function hsl(hue, sat, light) { return 'hsl(' + hue + ', ' + sat + '%, ' + light + '%)'; }

  function isLight(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) {
      var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.45;
    }
    var hm = /hsl\(\s*[\d.]+,\s*[\d.]+%,\s*([\d.]+)%\)/.exec(color);
    return hm ? parseFloat(hm[1]) > 48 : true;
  }

  function tone(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // caption ink: auto-contrast against the matte
  function captionColor(eff) {
    return isLight(matteHex(eff)) ? tone('--fr-frame-dark') : tone('--fr-frame-light');
  }

  function cssMM(el, name) {
    var v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return isNaN(v) ? 0 : v;
  }

  // nominal moulding width (mm) of the current design, for the Frame width label
  function mouldingMM(step) {
    if (s.moulding === 'none') return 0;
    frame.setAttribute('data-moulding', s.moulding);
    return (cssMM(frame, '--m-mm') || 60) * WIDTH_SCALE[(step || s.frameWeight) - 1];
  }

  // Dress any stage (the Art screen, or the launcher's miniature) in the current settings.
  // Like a real frame, the moulding sits at the stage's (screen's) edge; the mat, if any, is the
  // stage showing inside it, and the liner hugs the picture. With no moulding the TV's own bezel is
  // the frame and the stage is the mat inside it.
  // n = the picture's natural size (only used for Contain).
  function dress(st, fr, im, n, eff) {
    eff = eff || s;
    var light = isLight(matteHex(eff));
    fr.setAttribute('data-mount', eff.mount);
    fr.setAttribute('data-moulding', eff.moulding);
    fr.setAttribute('data-light', eff.light);
    fr.setAttribute('data-core', light ? 'light' : 'dark');
    im.setAttribute('data-fit', eff.fit);

    var r = st.getBoundingClientRect();
    var u = Math.min(r.width, r.height) / 100;
    var mm = u / MM_PER_U;
    var framed = eff.moulding !== 'none';
    var mw = eff.mount === 'bevel' ? BEVEL_MM * mm
      : eff.mount === 'float' && !framed ? 0   // a floater's gap only exists inside a moulding
      : cssMM(fr, '--l-mm') * mm;
    var fw = framed ? (cssMM(fr, '--m-mm') || 60) * WIDTH_SCALE[eff.frameWeight - 1] * mm : 0;
    var matte = framed && eff.fit === 'contain' ? Math.max(eff.matte, CONTAIN_MIN_MAT) : eff.matte;
    var mat = matte * u, matB = (matte + eff.matteBottom) * u;
    var pt = fw + mat, px = fw + mat, pb = fw + matB;

    st.style.padding = pt + 'px ' + px + 'px ' + pb + 'px';
    st.setAttribute('data-framed', String(framed));
    st.style.setProperty('--u', u + 'px');
    st.style.setProperty('--mm', mm + 'px');
    st.style.setProperty('--mw', mw + 'px');
    st.style.setProperty('--fw', fw + 'px');
    st.style.setProperty('--lx', eff.light === 'right' ? -1 : 1);
    st.style.setProperty('--mat-grain', eff.matteColor === 'black' ? 0 : light ? 0.55 : 0.35);
    st.style.setProperty('--matte', matte);
    st.style.setProperty('--matte-color', matteHex(eff));
    st.style.setProperty('--frame-color', captionColor(eff));

    var aw = Math.max(1, r.width - px * 2 - mw * 2), ah = Math.max(1, r.height - pt - pb - mw * 2);
    var w = aw, h = ah;
    if (eff.fit === 'contain') {
      var k = Math.min(aw / n.w, ah / n.h);
      w = Math.round(n.w * k); h = Math.round(n.h * k);
    }
    fr.style.width = w + 'px';
    fr.style.height = h + 'px';

    // the stage centres the picture in its padded box; the moulding reaches from the picture's
    // edges out to the stage's edges
    var top = pt + (r.height - pt - pb - h) / 2, left = (r.width - w) / 2;
    st.style.setProperty('--ft', top + 'px');
    st.style.setProperty('--fb', (r.height - top - h) + 'px');
    st.style.setProperty('--fl', left + 'px');
    st.style.setProperty('--fr', left + 'px');
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
    label.hidden = s.label !== 'on';
    showPicture(item);
    layout();
    syncPanel();
  }

  // When the picture changes (slideshow tick, Picture row), every settings row must show the new
  // picture's own look — not the previous picture's values. Runs whether or not the panel is open.
  var SYNC_IDS = ['fit', 'moulding', 'profile', 'frameWeight', 'mount', 'matte', 'matteBottom', 'matteColor', 'customHue', 'customSat', 'customLight', 'label', 'light', 'drift'];
  function syncPanel() {
    if (!api) return;
    for (var i = 0; i < SYNC_IDS.length; i++) api.set(SYNC_IDS[i], s[SYNC_IDS[i]]);
    var none = s.moulding === 'none';
    api.setHidden('frameWeight', none); api.setHidden('profile', none);
    var custom = s.matteColor === 'custom';
    api.setHidden('customHue', !custom); api.setHidden('customSat', !custom); api.setHidden('customLight', !custom);
  }

  // Paint the picture on the inactive layer, then flip — the opacity transition is --fr-motion-art.
  function showPicture(item) {
    if (!item) { labelTitle.textContent = 'No pictures in library'; labelMeta.textContent = ''; return; }
    image.setAttribute('aria-label', item.title);
    labelTitle.textContent = item.title;
    labelMeta.textContent = item.meta || '';
    paintStatus();
    if (item.src === shownSrc) return;
    shownSrc = item.src;
    var img = new Image();
    img.onload = function () {
      if (shownSrc !== item.src) return; // superseded by a faster advance
      natural = { w: img.naturalWidth || 3, h: img.naturalHeight || 2 };
      naturals[item.src] = natural;
      var nextLayer = layers[1 - active];
      nextLayer.style.backgroundImage = 'url("' + item.src + '")';
      layout();
      nextLayer.setAttribute('data-active', 'true');
      layers[active].setAttribute('data-active', 'false');
      active = 1 - active;
    };
    img.src = item.src;
  }

  function paintStatus() {
    var p = F.slideshow.position(), ss = F.slideshow.get();
    panelStatus.textContent = p.item
      ? (p.index + 1) + ' of ' + p.count + ' · ' + p.item.title + ' · ' + F.slideshow.cadenceLabel(ss) + (ss.cadence === 'off' ? '' : ', ' + ss.order)
      : 'Library is empty';
    if (api) api.set('picture', p.index + 1);
  }

  function everyLabel(v) {
    var c = F.slideshow.get().cadence;
    return v + ' ' + (c === 'days' ? (v === 1 ? 'day' : 'days') : (v === 1 ? 'hour' : 'hours'));
  }

  function layout() { dress(stage, frame, image, natural, s); applyDrift(); }

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
    paintStatus();
    F.nav.setScope(panel);
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
    var ss = F.slideshow.get(), pos = F.slideshow.position();
    var none = s.moulding === 'none';
    var specs = [
      { id: 'picture', name: 'Picture', type: 'range', value: pos.index + 1, min: 1, max: Math.max(1, pos.count), step: 1,
        format: function (v) { return v + ' of ' + pos.count; } },
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
      { id: 'fit', name: 'Image fit', type: 'choice', value: s.fit, options: [
        { value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }] },
      { id: 'moulding', name: 'Frame', type: 'choice', value: s.moulding, options: MOULDINGS },
      { id: 'frameWeight', name: 'Frame width', type: 'range', value: s.frameWeight, min: 1, max: 10, step: 1, hidden: none,
        format: function (v) { return (Math.round(mouldingMM(v) / 5) / 2) + ' cm'; } },
      { id: 'mount', name: 'Liner', type: 'choice', value: s.mount, options: MOUNTS },
      { id: 'light', name: 'Light from', type: 'choice', value: s.light, hidden: none, options: [
        { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
      { id: 'matte', name: 'Matte width', type: 'range', value: s.matte, min: 0, max: 30, step: 1, unit: '%', fastStep: 3 },
      { id: 'matteBottom', name: 'Bottom weight', type: 'range', value: s.matteBottom, min: 0, max: 10, step: 1, unit: '%' },
      { id: 'matteColor', name: 'Matte', type: 'swatch', value: s.matteColor, options: MATTES },
      { id: 'customHue', name: 'Custom hue', type: 'range', value: s.customHue, min: 0, max: 360, step: 5, unit: '°', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'customSat', name: 'Custom saturation', type: 'range', value: s.customSat, min: 0, max: 100, step: 2, unit: '%', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'customLight', name: 'Custom lightness', type: 'range', value: s.customLight, min: 0, max: 100, step: 2, unit: '%', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'label', name: 'Caption', type: 'choice', value: s.label, options: [
        { value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }] },
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
      } else if (id === 'picture') {
        F.slideshow.goTo(value - 1);
      } else {
        var patch = {}; patch[id] = value; save(patch);
        if (id === 'matteColor') {
          var custom = value === 'custom';
          api.setHidden('customHue', !custom); api.setHidden('customSat', !custom); api.setHidden('customLight', !custom);
        }
        if (id === 'moulding') { api.setHidden('frameWeight', value === 'none'); api.setHidden('light', value === 'none'); }
      }
      apply();
      if (id === 'moulding') api.set('frameWeight', s.frameWeight); // relabel the width in cm for this design
    });
  }

  // The launcher's miniature uses the same renderer, painting the current picture directly
  // in that picture's own remembered look.
  F.art = {
    paintInto: function (st, fr, im) {
      var item = F.slideshow.current();
      if (!item) return;
      im.style.backgroundImage = 'url("' + item.src + '")';
      var n = naturals[item.src];
      var eff = effective(item.id);
      dress(st, fr, im, n || natural, eff);
      if (!n) {
        var img = new Image();
        img.onload = function () {
          naturals[item.src] = { w: img.naturalWidth || 3, h: img.naturalHeight || 2 };
          dress(st, fr, im, naturals[item.src], eff);
        };
        img.src = item.src;
      }
    }
  };

  // the sequencer advanced (timer, catch-up, manual, or from the Settings screen)
  F.slideshow.subscribe(function () { if (!el.hidden) apply(); });
  // library swapped at runtime (remote manifest arrived): refresh the Picture row's range + status
  window.addEventListener('framed:library', function () { if (!el.hidden) { buildControls(); apply(); } });

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
    },
    leave: function () { F.adaptive.stop(); F.slideshow.pause(); closePanel(); clearTimeout(chromeTimer); clearInterval(driftTimer); },
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
