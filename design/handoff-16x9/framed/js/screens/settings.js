/*
 * framed — Settings screen: brightness, Art Mode floor, slideshow, theme, about.
 * Brightness and floor go through window.__tvBridge and persist under "framed.settings".
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-settings');
  var DEFAULTS = { brightness: 100, artFloor: 10, theme: 'mhach', homeTv: 'on' };
  var s = F.store.merge('settings', {}, DEFAULTS);

  var floorSwatch = document.getElementById('floor-swatch');
  var aboutBridge = document.getElementById('about-bridge');
  var aboutLibrary = document.getElementById('about-library');

  function pct(v) { return v + '%'; }

  function paintFloor() {
    floorSwatch.style.setProperty('--floor-dim', String(1 - s.artFloor / 100));
  }

  window.addEventListener('framed:library', function () { if (!el.hidden) paintAbout(); });

  function paintAbout() {
    var st = window.__tvBridge.getState();
    aboutBridge.textContent = st.platform;
    var left = F.library.rejected().length;
    aboutLibrary.textContent = F.library.list().length + ' pictures, ' + F.library.source() +
      (left ? ' · ' + left + ' left out (not 16:9)' : '');
  }

  function build() {
    F.controls.render(document.getElementById('settings-brightness'), [
      { id: 'brightness', name: 'Brightness', type: 'range', value: s.brightness, min: 0, max: 100, step: 1, fastStep: 5, format: pct }
    ], function (id, v) {
      s = F.store.merge('settings', { brightness: v }, DEFAULTS);
      window.__tvBridge.setBrightness(v);
      paintAbout();
    });

    F.controls.render(document.getElementById('settings-floor'), [
      { id: 'artFloor', name: 'Art floor', type: 'range', value: s.artFloor, min: 0, max: 100, step: 1, fastStep: 5, format: pct }
    ], function (id, v) {
      s = F.store.merge('settings', { artFloor: v }, DEFAULTS);
      window.__tvBridge.setArtFloor(v);
      paintFloor();
      paintAbout();
    });

    F.controls.render(document.getElementById('settings-slideshow'), [
      { id: 'cadence', name: 'Slideshow', type: 'choice', value: F.slideshow.get().cadence, options: F.slideshow.CADENCES },
      { id: 'order', name: 'Order', type: 'choice', value: F.slideshow.get().order, options: F.slideshow.ORDERS }
    ], function (id, v) {
      var patch = {}; patch[id] = v; F.slideshow.set(patch);
    });

    // home miniature: drawn inside the TV's own bezel, or the art alone (read by launcher.js)
    F.controls.render(document.getElementById('settings-home'), [
      { id: 'homeTv', name: 'Home art', type: 'choice', value: s.homeTv, options: [
        { value: 'on', label: 'TV frame' }, { value: 'off', label: 'Art only' }] }
    ], function (id, v) {
      s = F.store.merge('settings', { homeTv: v }, DEFAULTS);
    });

    F.controls.render(document.getElementById('settings-theme'), [
      // each value maps to an html[data-theme="…"] block in css/theme.css
      { id: 'theme', name: 'Theme', type: 'choice', value: s.theme, options: [
        { value: 'mhach', label: 'Mhach' },
        { value: 'amdapor', label: 'Amdapor', disabled: true },
        { value: 'nym', label: 'Nym', disabled: true }] }
    ], function (id, v, spec, meta) {
      if (meta && meta.rejected) { F.toast('Not built yet', 'error'); return; }
      s = F.store.merge('settings', { theme: v }, DEFAULTS);
      document.documentElement.setAttribute('data-theme', v);
    });
  }

  // push persisted values into the bridge at boot so the TV matches what the user last chose
  window.__tvBridge.setBrightness(s.brightness);
  window.__tvBridge.setArtFloor(s.artFloor);

  F.router.register('settings', {
    el: el,
    enter: function () {
      build();
      paintFloor();
      paintAbout();
      F.nav.setScope(el, { remember: false });
    }
  });
})(window.framed);
