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

  // Rotate Off / Hours / Days, with an "Every N" interval row that hides on Off and
  // re-ranges to the unit (1–48 hours, 1–30 days). Rebuilt on unit change.
  function buildSlideshow() {
    var g = F.slideshow.get();
    F.controls.render(document.getElementById('settings-slideshow'), [
      { id: 'cadence', name: 'Slideshow', type: 'choice', value: g.cadence, options: F.slideshow.CADENCES },
      { id: 'every', name: 'Every', type: 'range', value: g.every, min: 1, max: F.slideshow.everyMax(g), step: 1, hidden: g.cadence === 'off',
        format: function (v) {
          var c = F.slideshow.get().cadence;
          return v + ' ' + (c === 'days' ? (v === 1 ? 'day' : 'days') : (v === 1 ? 'hour' : 'hours'));
        } },
      { id: 'order', name: 'Order', type: 'choice', value: g.order, options: F.slideshow.ORDERS }
    ], function (id, v) {
      if (id === 'cadence') {
        F.slideshow.set({ cadence: v });
        buildSlideshow();
        return;
      }
      var patch = {}; patch[id] = v; F.slideshow.set(patch);
    });
  }

  function paintFloor() {
    floorSwatch.style.setProperty('--floor-dim', String(1 - s.artFloor / 100));
  }

  window.addEventListener('framed:library', function () { if (!el.hidden) paintAbout(); });

  function paintAbout() {
    var st = window.__tvBridge.getState();
    aboutBridge.textContent = st.platform;
    aboutLibrary.textContent = F.library.list().length + ' pictures, ' + F.library.source();
  }

  function build() {
    F.controls.render(document.getElementById('settings-brightness'), [
      { id: 'brightness', name: 'Brightness', type: 'range', value: s.brightness, min: 0, max: 100, step: 1, fastStep: 5, format: pct }
    ], function (id, v) {
      s = F.store.merge('settings', { brightness: v }, DEFAULTS);
      window.__tvBridge.setBrightness(v);
      window.dispatchEvent(new CustomEvent('framed:settings'));   // the art stage dims live
      paintAbout();
    });

    F.controls.render(document.getElementById('settings-floor'), [
      { id: 'artFloor', name: 'Art floor', type: 'range', value: s.artFloor, min: 0, max: 100, step: 1, fastStep: 5, format: pct }
    ], function (id, v) {
      s = F.store.merge('settings', { artFloor: v }, DEFAULTS);
      window.__tvBridge.setArtFloor(v);
      window.dispatchEvent(new CustomEvent('framed:settings'));
      paintFloor();
      paintAbout();
    });

    buildSlideshow();

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
