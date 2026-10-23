/*
 * framed — Settings screen: brightness, Art Mode floor, theme, about.
 * Brightness and floor go through window.__tvBridge and persist under "framed.settings".
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-settings');
  var DEFAULTS = { brightness: 100, artFloor: 10, theme: 'placeholder' };
  var s = F.store.merge('settings', {}, DEFAULTS);

  var floorSwatch = document.getElementById('floor-swatch');
  var floorCaption = document.getElementById('floor-caption');
  var aboutBridge = document.getElementById('about-bridge');
  var aboutRuntime = document.getElementById('about-runtime');
  var aboutLibrary = document.getElementById('about-library');

  function pct(v) { return v + '%'; }

  function paintFloor() {
    floorSwatch.style.setProperty('--floor-dim', String(1 - s.artFloor / 100));
    floorCaption.textContent = s.artFloor === 0 ? 'Floor 0% — art can fade fully to black.'
      : s.artFloor <= 15 ? 'Floor ' + s.artFloor + '% — barely-there glow in a dark room.'
      : s.artFloor <= 40 ? 'Floor ' + s.artFloor + '% — dim but readable.'
      : 'Floor ' + s.artFloor + '% — close to stock Art Mode behaviour.';
  }

  var slideshowStatus = document.getElementById('slideshow-status');
  function paintSlideshow() {
    var p = F.slideshow.position();
    slideshowStatus.textContent = p.item ? 'Showing ' + (p.index + 1) + ' of ' + p.count + ' · ' + p.item.title : 'Library is empty';
  }

  window.addEventListener('framed:library', function () { if (!el.hidden) { paintSlideshow(); paintAbout(); } });

  function paintAbout() {
    var st = window.__tvBridge.getState();
    aboutBridge.textContent = st.platform + (st.isStub ? ' (stub — calls are logged, not applied)' : '') +
      ' · brightness ' + st.brightness + ' · floor ' + st.artFloor;
    aboutRuntime.textContent = window.tizen ? 'Tizen ' + (tizen.systeminfo ? 'TV' : '') : 'desktop browser preview';
    var base = F.library.remoteBase();
    aboutLibrary.textContent = F.library.source() + ' · ' + F.library.list().length + ' pictures' +
      (base ? ' · remote ' + base : ' · remote disabled (REMOTE_ART_BASE in js/library.js)');
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
      { id: 'artFloor', name: 'Ambient floor', type: 'range', value: s.artFloor, min: 0, max: 100, step: 1, fastStep: 5, format: pct,
        help: '0% lets Art Mode go fully dark in a pitch-black room.' }
    ], function (id, v) {
      s = F.store.merge('settings', { artFloor: v }, DEFAULTS);
      window.__tvBridge.setArtFloor(v);
      paintFloor();
      paintAbout();
    });

    F.controls.render(document.getElementById('settings-slideshow'), [
      { id: 'cadence', name: 'Rotate', type: 'choice', value: F.slideshow.get().cadence, options: F.slideshow.CADENCES },
      { id: 'order', name: 'Order', type: 'choice', value: F.slideshow.get().order, options: F.slideshow.ORDERS }
    ], function (id, v) {
      var patch = {}; patch[id] = v; F.slideshow.set(patch);
      paintSlideshow();
    });

    F.controls.render(document.getElementById('settings-theme'), [
      // DESIGN SURFACE: the real theme list replaces these entries; each value maps to an
      // html[data-theme="…"] block in the theme CSS file.
      { id: 'theme', name: 'Theme', type: 'choice', value: s.theme, options: [
        { value: 'placeholder', label: 'Placeholder scaffold' },
        { value: 'theme-a', label: 'Theme A · soon', disabled: true },
        { value: 'theme-b', label: 'Theme B · soon', disabled: true }] }
    ], function (id, v, spec, meta) {
      if (meta && meta.rejected) { F.toast('That theme is coming soon', 'error'); return; }
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
      paintSlideshow();
      paintFloor();
      paintAbout();
      F.nav.setScope(el, { remember: false });
    }
  });
})(window.framed);
