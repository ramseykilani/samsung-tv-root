/*
 * framed — Settings screen: framed-level settings only (home art, theme, about).
 * Art-level settings (brightness, adaptive, slideshow, start-in,
 * frame/matte/fit, pixel shift) live in the Art screen's controls panel, where
 * each change previews on the art itself — see screens/art.js buildControls.
 * Manual brightness is still pushed through window.__tvBridge at boot so
 * the TV matches what the user last chose; values persist under "framed.settings".
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-settings');
  var DEFAULTS = { brightness: 100, adaptiveBrightness: 'on', adaptiveTone: 'on', theme: 'mhach', homeTv: 'on', startScreen: 'launcher' };
  var s = F.store.merge('settings', {}, DEFAULTS);

  var aboutBridge = document.getElementById('about-bridge');
  var aboutLibrary = document.getElementById('about-library');

  window.addEventListener('framed:library', function () { if (!el.hidden) paintAbout(); });

  function paintAbout() {
    var st = window.__tvBridge.getState();
    aboutBridge.textContent = st.platform;
    var left = F.library.rejected();
    aboutLibrary.textContent = F.library.list().length + ' pictures, ' + F.library.source() +
      (left ? ' · ' + left + ' left out (not 16:9)' : '');
  }

  function build() {
    s = F.store.merge('settings', {}, DEFAULTS);
    if (!s.adaptiveDefaulted) {   // same one-time migration as adaptive.js
      s = F.store.merge('settings', { adaptiveBrightness: 'on', adaptiveTone: 'on', adaptiveDefaulted: true }, DEFAULTS);
    }

    // home miniature: drawn inside the TV's own bezel, or the art alone (read by launcher.js).
    F.controls.render(document.getElementById('settings-home'), [
      { id: 'homeTv', name: 'Home art', type: 'choice', value: s.homeTv, options: [
        { value: 'on', label: 'TV frame' }, { value: 'off', label: 'Art only' }] }
    ], function (id, v) {
      var patch = {}; patch[id] = v;
      s = F.store.merge('settings', patch, DEFAULTS);
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

  F.router.register('settings', {
    el: el,
    enter: function () {
      build();
      paintAbout();
      F.nav.setScope(el, { remember: false });
    }
  });
})(window.framed);
