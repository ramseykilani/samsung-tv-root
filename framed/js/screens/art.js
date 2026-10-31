/*
 * framed — Art screen. Fullscreen picture in a drawn frame (moulding × liner, lit from the chosen side)
 * with an optional mat; the slideshow sequencer (js/slideshow.js) decides which library picture is current.
 * No chrome while art is shown; the corner affordance (or the `s` key) opens the settings panel.
 * While the panel is closed: Left/Right = previous/next picture, `p` / MediaPlayPause = slideshow
 * on/off. Frame/matte settings persist under "framed.art"; slideshow prefs under "framed.slideshow".
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
    label: 'off'
  };

  function has(list, v) { for (var i = 0; i < list.length; i++) if (list[i].value === v) return true; return false; }
  // stored settings from any version: unknown values fall back, retired ones map to their successor
  function sanitize(o) {
    if (!has(MOULDINGS, o.moulding)) o.moulding = RETIRED[o.moulding] || DEFAULTS.moulding;
    if (!has(MOUNTS, o.mount)) o.mount = RETIRED[o.mount] || DEFAULTS.mount;
    if (o.light !== 'left' && o.light !== 'right') o.light = DEFAULTS.light;
    if (o.fit !== 'contain' && o.fit !== 'cover') o.fit = DEFAULTS.fit;
    var w = Math.round(Number(o.frameWeight));
    o.frameWeight = w >= 1 && w <= 10 ? w : DEFAULTS.frameWeight;
    if (!(Number(o.matte) >= 0)) o.matte = DEFAULTS.matte;
    if (!(Number(o.matteBottom) >= 0)) o.matteBottom = DEFAULTS.matteBottom;
    delete o.profile; // retired: each moulding now has its own profile
    return o;
  }

  var s = F.store.set('art', sanitize(F.store.merge('art', {}, DEFAULTS)));
  var api = null;
  var natural = { w: 3, h: 2 };
  var naturals = {};         // src -> { w, h }, for the launcher's miniature
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var KEY = { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, PLAY_PAUSE: 179, TIZEN_PLAY_PAUSE: 10252 };

  function save(patch) { s = F.store.set('art', sanitize(F.store.merge('art', patch, DEFAULTS))); }

  function matteHex() {
    if (s.matteColor === 'custom') return hsl(s.customHue, s.customSat, s.customLight);
    for (var i = 0; i < MATTES.length; i++) if (MATTES[i].value === s.matteColor) return MATTES[i].color;
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
  function captionColor() {
    return isLight(matteHex()) ? tone('--fr-frame-dark') : tone('--fr-frame-light');
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
  function dress(st, fr, im, n) {
    var light = isLight(matteHex());
    fr.setAttribute('data-mount', s.mount);
    fr.setAttribute('data-moulding', s.moulding);
    fr.setAttribute('data-light', s.light);
    fr.setAttribute('data-core', light ? 'light' : 'dark');
    im.setAttribute('data-fit', s.fit);

    var r = st.getBoundingClientRect();
    var u = Math.min(r.width, r.height) / 100;
    var mm = u / MM_PER_U;
    var framed = s.moulding !== 'none';
    var mw = s.mount === 'bevel' ? BEVEL_MM * mm
      : s.mount === 'float' && !framed ? 0   // a floater's gap only exists inside a moulding
      : cssMM(fr, '--l-mm') * mm;
    var fw = framed ? (cssMM(fr, '--m-mm') || 60) * WIDTH_SCALE[s.frameWeight - 1] * mm : 0;
    var matte = framed && s.fit === 'contain' ? Math.max(s.matte, CONTAIN_MIN_MAT) : s.matte;
    var mat = matte * u, matB = (matte + s.matteBottom) * u;
    var pt = fw + mat, px = fw + mat, pb = fw + matB;

    st.style.padding = pt + 'px ' + px + 'px ' + pb + 'px';
    st.setAttribute('data-framed', String(framed));
    st.style.setProperty('--u', u + 'px');
    st.style.setProperty('--mm', mm + 'px');
    st.style.setProperty('--mw', mw + 'px');
    st.style.setProperty('--fw', fw + 'px');
    st.style.setProperty('--lx', s.light === 'right' ? -1 : 1);
    st.style.setProperty('--mat-grain', s.matteColor === 'black' ? 0 : light ? 0.55 : 0.35);
    st.style.setProperty('--matte', matte);
    st.style.setProperty('--matte-color', matteHex());
    st.style.setProperty('--frame-color', captionColor());

    var aw = Math.max(1, r.width - px * 2 - mw * 2), ah = Math.max(1, r.height - pt - pb - mw * 2);
    var w = aw, h = ah;
    if (s.fit === 'contain') {
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

  function apply() {
    label.hidden = s.label !== 'on';
    showPicture(F.slideshow.current());
    layout();
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
      ? (p.index + 1) + ' of ' + p.count + ' · ' + p.item.title + ' · ' + F.slideshow.cadenceLabel(ss.cadence) + (ss.cadence === 'off' ? '' : ', ' + ss.order)
      : 'Library is empty';
    if (api) api.set('picture', p.index + 1);
  }

  function layout() { dress(stage, frame, image, natural); }

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
      { id: 'order', name: 'Order', type: 'choice', value: ss.order, options: F.slideshow.ORDERS },
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
      { id: 'reset', name: 'Reset', type: 'action' }
    ];
    api = F.controls.render(controlsEl, specs, function (id, value) {
      if (id === 'reset') {
        s = F.store.set('art', sanitize(F.store.merge('art', DEFAULTS, DEFAULTS)));
        F.slideshow.set({ cadence: F.slideshow.DEFAULTS.cadence, order: F.slideshow.DEFAULTS.order });
        buildControls();
        F.nav.setScope(panel, { remember: false, initial: api.el('reset') });
        F.toast('Reset', 'ok');
      } else if (id === 'cadence' || id === 'order') {
        var sp = {}; sp[id] = value; F.slideshow.set(sp);
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

  // The launcher's miniature uses the same renderer, painting the current picture directly.
  F.art = {
    paintInto: function (st, fr, im) {
      var item = F.slideshow.current();
      if (!item) return;
      im.style.backgroundImage = 'url("' + item.src + '")';
      var n = naturals[item.src];
      dress(st, fr, im, n || natural);
      if (!n) {
        var img = new Image();
        img.onload = function () {
          naturals[item.src] = { w: img.naturalWidth || 3, h: img.naturalHeight || 2 };
          dress(st, fr, im, naturals[item.src]);
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
      F.slideshow.start();   // catch up (daily / elapsed periods) and tick while art is shown
      buildControls();
      apply();
      F.nav.setScope(el, { initial: corner, remember: false });
      showChrome(3000);
    },
    leave: function () { F.slideshow.pause(); closePanel(); clearTimeout(chromeTimer); },
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
        F.toast(c === 'off' ? 'Slideshow off' : 'Slideshow: ' + F.slideshow.cadenceLabel(c), 'info');
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
