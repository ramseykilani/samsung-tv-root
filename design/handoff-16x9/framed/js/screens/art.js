/*
 * framed — Art screen. The picture fills the screen, in a thin drawn frame (lit from the chosen side) that
 * continues the TV's own black bezel, so the whole TV reads as one picture frame. Pictures are 16:9
 * (js/library.js refuses any other shape), and the frame hugs the whole picture: it is the same width all
 * round and its opening is 16:9 too, so nothing of the picture is ever hidden. The few mm left over at the
 * sides are the bezel's black, which the frame's flat black face continues. No mat, no caption.
 * The slideshow sequencer (js/slideshow.js) decides which library picture is current.
 * No chrome while art is shown; the corner affordance (or the `s` key) opens the settings panel, which
 * opens on a grid of the library's pictures. While the panel is closed: Left/Right = previous/next
 * picture, `p` / MediaPlayPause = slideshow on/off. Frame settings persist under "framed.art"; slideshow
 * prefs under "framed.slideshow". Rendering of mouldings and liners lives in css/frames.css; this file
 * sets their geometry.
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
    light: 'left'
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
    DROPPED.forEach(function (k) { delete o[k]; });
    return o;
  }

  var s = F.store.set('art', sanitize(F.store.merge('art', {}, DEFAULTS)));
  var api = null;
  var active = 0;            // index into layers[]
  var shownSrc = null;
  var panelOpen = false;
  var chromeTimer;
  var KEY = { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, PLAY_PAUSE: 179, TIZEN_PLAY_PAUSE: 10252 };

  function save(patch) { s = F.store.set('art', sanitize(F.store.merge('art', patch, DEFAULTS))); }

  function cssMM(el, name) {
    var v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return isNaN(v) ? 0 : v;
  }

  // Dress any stage (the Art screen, or the launcher's miniature) in the current settings.
  // The picture is 16:9 and as large as the stage allows; the liner and moulding hug it, the same width
  // all round, so the moulding meets the stage's (screen's) edge at the top and bottom and the bezel's
  // black shows for the few mm left at the sides. With no frame the picture is the whole screen.
  function dress(st, fr) {
    var f = frameOf(s.frame);
    fr.setAttribute('data-mount', f.mount);
    fr.setAttribute('data-moulding', f.moulding);
    fr.setAttribute('data-light', s.light);

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
    st.style.setProperty('--lx', s.light === 'right' ? -1 : 1);

    var h = Math.max(1, Math.min(r.height - 2 * t, (r.width - 2 * t) / SCREEN)), w = h * SCREEN;
    fr.style.width = w + 'px';
    fr.style.height = h + 'px';

    // the moulding's outer edge, measured from the picture's edge: the same all round
    ['--ft', '--fb', '--fl', '--fr'].forEach(function (k) { st.style.setProperty(k, t + 'px'); });
  }

  function apply() {
    showPicture(F.slideshow.current());
    layout();
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

  function layout() { dress(stage, frame); }

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
      { id: 'order', name: 'Order', type: 'choice', value: ss.order, options: F.slideshow.ORDERS },
      { id: 'frame', name: 'Frame', type: 'choice', value: s.frame, options: FRAMES },
      { id: 'light', name: 'Light from', type: 'choice', value: s.light, hidden: none, options: [
        { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
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
      } else {
        var patch = {}; patch[id] = value; save(patch);
        if (id === 'frame') api.setHidden('light', value === 'none');
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
      dress(st, fr);
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
      F.slideshow.start();   // catch up (daily / elapsed periods) and tick while art is shown
      buildPictures();
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
