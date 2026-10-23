/*
 * framed — Art screen. Fullscreen image on a matte, with a frame style; the slideshow
 * sequencer (js/slideshow.js) decides which library picture is current.
 * No chrome while art is shown; the corner affordance (or the `s` key) opens the settings panel.
 * While the panel is closed: Left/Right = previous/next picture, `p` / MediaPlayPause = slideshow
 * on/off. Matte/frame settings persist under "framed.art"; slideshow prefs under "framed.slideshow".
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

  // 8 matte presets + custom. DESIGN SURFACE: the preset palette is a placeholder neutral ramp;
  // the designer replaces values/labels here (the mechanics only need value/label/color).
  var MATTES = [
    { value: 'white', label: 'White', color: '#FFFFFF' },
    { value: 'warm-white', label: 'Warm white', color: '#F2EDE4' },
    { value: 'light-gray', label: 'Light gray', color: '#E6E6E6' },
    { value: 'mid-gray', label: 'Mid gray', color: '#BFBFBF' },
    { value: 'gray', label: 'Gray', color: '#808080' },
    { value: 'dark-gray', label: 'Dark gray', color: '#404040' },
    { value: 'near-black', label: 'Near black', color: '#202020' },
    { value: 'black', label: 'Black', color: '#000000' },
    { value: 'custom', label: 'Custom' }
  ];

  var DEFAULTS = {
    fit: 'contain',
    matte: 8,
    matteBottom: 2,
    matteColor: 'light-gray',
    customHue: 30,
    customSat: 20,
    customLight: 85,
    frame: 'thin',
    frameWeight: 2,
    frameTone: 'auto',
    label: 'on'
  };

  var s = F.store.merge('art', {}, DEFAULTS);
  var api = null;
  var natural = { w: 3, h: 2 };
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var KEY = { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, PLAY_PAUSE: 179, TIZEN_PLAY_PAUSE: 10252 };

  function save(patch) { s = F.store.merge('art', patch, DEFAULTS); }

  function matteHex() {
    if (s.matteColor === 'custom') return hsl(s.customHue, s.customSat, s.customLight);
    for (var i = 0; i < MATTES.length; i++) if (MATTES[i].value === s.matteColor) return MATTES[i].color;
    return '#E6E6E6';
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

  function frameColor() {
    switch (s.frameTone) {
      case 'dark': return '#111111';
      case 'light': return '#F0F0F0';
      default: return isLight(matteHex()) ? '#111111' : '#F0F0F0';
    }
  }

  function apply() {
    stage.style.setProperty('--matte', s.matte);
    stage.style.setProperty('--matte-bottom', s.matteBottom);
    stage.style.setProperty('--matte-color', matteHex());
    stage.style.setProperty('--frame-color', frameColor());
    stage.style.setProperty('--frame-weight', s.frameWeight + 'px');
    frame.setAttribute('data-frame', s.frame);
    image.setAttribute('data-fit', s.fit);
    label.hidden = s.label !== 'on';
    showPicture(F.slideshow.current());
    layout();
  }

  // Paint the picture on the inactive layer, then flip — the opacity transition is --fr-motion.
  function showPicture(item) {
    if (!item) { labelTitle.textContent = 'No pictures in library'; labelMeta.textContent = 'see js/library.js'; return; }
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

  // Size the frame to hug the image (contain) or fill the matte opening (cover).
  function layout() {
    var r = stage.getBoundingClientRect();
    var vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    var pad = s.matte * vmin;
    var aw = Math.max(1, r.width - pad * 2);
    var ah = Math.max(1, r.height - pad * 2 - s.matteBottom * vmin);
    var w = aw, h = ah;
    if (s.fit === 'contain') {
      var k = Math.min(aw / natural.w, ah / natural.h);
      w = Math.round(natural.w * k); h = Math.round(natural.h * k);
    }
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
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
    var specs = [
      { id: 'cadence', name: 'Slideshow', type: 'choice', value: ss.cadence, options: F.slideshow.CADENCES,
        help: 'Daily picks a new picture each day the app is opened.' },
      { id: 'order', name: 'Order', type: 'choice', value: ss.order, options: F.slideshow.ORDERS },
      { id: 'picture', name: 'Picture', type: 'range', value: pos.index + 1, min: 1, max: Math.max(1, pos.count), step: 1,
        format: function (v) { return v + ' of ' + pos.count; },
        help: 'Left/Right on the art screen also step through pictures.' },
      { id: 'fit', name: 'Image fit', type: 'choice', value: s.fit, options: [
        { value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }] },
      { id: 'matte', name: 'Matte width', type: 'range', value: s.matte, min: 0, max: 30, step: 1, unit: '%', fastStep: 3 },
      { id: 'matteBottom', name: 'Bottom weight', type: 'range', value: s.matteBottom, min: 0, max: 10, step: 1, unit: '%',
        help: 'Gallery mattes sit slightly heavier below the work.' },
      { id: 'matteColor', name: 'Matte colour', type: 'swatch', value: s.matteColor, options: MATTES },
      { id: 'customHue', name: 'Custom hue', type: 'range', value: s.customHue, min: 0, max: 360, step: 5, unit: '°', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'customSat', name: 'Custom saturation', type: 'range', value: s.customSat, min: 0, max: 100, step: 2, unit: '%', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'customLight', name: 'Custom lightness', type: 'range', value: s.customLight, min: 0, max: 100, step: 2, unit: '%', fastStep: 4, hidden: s.matteColor !== 'custom' },
      { id: 'frame', name: 'Frame', type: 'choice', value: s.frame, options: [
        { value: 'none', label: 'None' }, { value: 'thin', label: 'Hairline' }, { value: 'gallery', label: 'Double line' },
        { value: 'shadowbox', label: 'Shadow box' }, { value: 'corners', label: 'Corner marks' }] },
      { id: 'frameWeight', name: 'Frame weight', type: 'range', value: s.frameWeight, min: 1, max: 6, step: 1, unit: 'px' },
      { id: 'frameTone', name: 'Frame tone', type: 'choice', value: s.frameTone, options: [
        { value: 'auto', label: 'Auto contrast' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] },
      { id: 'label', name: 'Caption', type: 'choice', value: s.label, options: [
        { value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }] },
      { id: 'reset', name: 'Reset', type: 'action', label: 'Restore defaults' }
    ];
    api = F.controls.render(controlsEl, specs, function (id, value) {
      if (id === 'reset') {
        s = F.store.set('art', F.store.merge('art', DEFAULTS, DEFAULTS));
        F.slideshow.set({ cadence: F.slideshow.DEFAULTS.cadence, order: F.slideshow.DEFAULTS.order });
        buildControls();
        F.nav.setScope(panel, { remember: false, initial: api.el('reset') });
        F.toast('Art settings restored', 'ok');
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
      }
      apply();
    });
  }

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
