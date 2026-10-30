/*
 * framed — Art screen. Fullscreen picture in a drawn frame (finish × profile × liner) on an
 * optional matte; the slideshow sequencer (js/slideshow.js) decides which library picture is current.
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

  // Mount and moulding geometry, in hundredths of the stage's shorter edge (see css/frames.css).
  var MOUNT_DEPTH = { flat: 0, bevel: 0.7, double: 2.6, shadowbox: 2.4, float: 0, linen: 3.4, fillet: 1.0, slip: 1.5 };
  var BEVEL = 0.7, REVEAL = 1.2; // double mat: bevel, contrasting reveal, bevel
  var FLOAT_GAP = 2.8;          // float only shows a gap when a moulding surrounds it
  var MOULDING_STEP = 0.8;      // moulding width per Frame width step (1–10)

  // The owner's look: no mat, the picture fills the screen, and a drawn frame at the screen's
  // edges pairs with the TV's own bezel as a double frame.
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
    profile: 'scoop',
    frameWeight: 5,
    label: 'off'
  };

  var s = F.store.merge('art', {}, DEFAULTS);
  var api = null;
  var natural = { w: 3, h: 2 };
  var naturals = {};         // src -> { w, h }, for the launcher's miniature
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var KEY = { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, PLAY_PAUSE: 179, TIZEN_PLAY_PAUSE: 10252 };

  function save(patch) { s = F.store.merge('art', patch, DEFAULTS); }

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

  // Dress any stage (the Art screen, or the launcher's miniature) in the current settings and
  // size the picture so picture + mount + moulding fit inside the matte opening.
  // n = the picture's natural size (only used for Contain).
  function dress(st, fr, im, n) {
    var r = st.getBoundingClientRect();
    var u = Math.min(r.width, r.height) / 100;
    var framed = s.moulding !== 'none';
    var mw = (s.mount === 'float' ? (framed ? FLOAT_GAP : 0) : (MOUNT_DEPTH[s.mount] || 0)) * u;
    var fw = framed ? s.frameWeight * MOULDING_STEP * u : 0;
    var pad = s.matte * u, padB = (s.matte + s.matteBottom) * u;

    st.style.padding = pad + 'px ' + pad + 'px ' + padB + 'px';
    st.style.setProperty('--u', u + 'px');
    st.style.setProperty('--mw', mw + 'px');
    st.style.setProperty('--fw', fw + 'px');
    st.style.setProperty('--b', BEVEL * u + 'px');
    st.style.setProperty('--r', REVEAL * u + 'px');
    st.style.setProperty('--mat-grain', s.matteColor === 'black' ? 0 : isLight(matteHex()) ? 0.55 : 0.35);
    st.style.setProperty('--matte', s.matte);
    st.style.setProperty('--matte-color', matteHex());
    st.style.setProperty('--frame-color', captionColor());
    fr.setAttribute('data-mount', s.mount);
    fr.setAttribute('data-moulding', s.moulding);
    fr.setAttribute('data-profile', s.profile);
    fr.setAttribute('data-core', isLight(matteHex()) ? 'light' : 'dark');
    im.setAttribute('data-fit', s.fit);

    var ring = 2 * (mw + fw);
    var aw = Math.max(1, r.width - pad * 2 - ring), ah = Math.max(1, r.height - pad - padB - ring);
    var w = aw, h = ah;
    if (s.fit === 'contain') {
      var k = Math.min(aw / n.w, ah / n.h);
      w = Math.round(n.w * k); h = Math.round(n.h * k);
    }
    fr.style.width = w + 'px';
    fr.style.height = h + 'px';
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
      { id: 'moulding', name: 'Frame', type: 'choice', value: s.moulding, options: [
        { value: 'none', label: 'None' }, { value: 'black', label: 'Black' }, { value: 'ebony', label: 'Ebony' },
        { value: 'walnut', label: 'Walnut' }, { value: 'oak', label: 'Oak' }, { value: 'gilt', label: 'Gilt' },
        { value: 'silver', label: 'Silver' }, { value: 'white', label: 'White' }] },
      { id: 'profile', name: 'Profile', type: 'choice', value: s.profile, hidden: none, options: [
        { value: 'flat', label: 'Flat' }, { value: 'scoop', label: 'Scoop' },
        { value: 'cushion', label: 'Cushion' }, { value: 'ornate', label: 'Ornate' }] },
      { id: 'frameWeight', name: 'Frame width', type: 'range', value: s.frameWeight, min: 1, max: 10, step: 1, hidden: none },
      { id: 'mount', name: 'Liner', type: 'choice', value: s.mount, options: [
        { value: 'flat', label: 'None' }, { value: 'fillet', label: 'Gold fillet' }, { value: 'linen', label: 'Linen' },
        { value: 'slip', label: 'Black slip' }, { value: 'bevel', label: 'Bevel' }, { value: 'double', label: 'Double mat' },
        { value: 'shadowbox', label: 'Shadowbox' }, { value: 'float', label: 'Float' }] },
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
        s = F.store.set('art', F.store.merge('art', DEFAULTS, DEFAULTS));
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
        if (id === 'moulding') { api.setHidden('frameWeight', value === 'none'); api.setHidden('profile', value === 'none'); }
      }
      apply();
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
