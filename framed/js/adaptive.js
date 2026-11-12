(function (F) {
  var core = F.adaptiveCore, sensor = null, running = false, generation = 0;
  var pollTimer = null, paintTimer = null, fadeStarted = 0, fadeFrom = null, fadeTarget = null, current = null, error = '', lastMatrix = '';
  var matrix = document.getElementById('adaptive-color-matrix');
  var stage = document.getElementById('art-stage');
  function settings() {
    var s = F.store.get('settings', {});
    if (!s.adaptiveDefaulted) {   // one-time migration: adaptive brightness/tone on by default
      F.store.merge('settings', { adaptiveBrightness: 'on', adaptiveTone: 'on', adaptiveDefaulted: true }, {});
      s = F.store.get('settings', {});
    }
    return s;
  }
  function enabled() { var s = settings(); return s.adaptiveBrightness === 'on' || s.adaptiveTone === 'on'; }
  function artVisible() { return F.router && F.router.current() === 'art'; }
  function paint(immediate) {
    var now = Date.now(), target = core.target(settings(), sensor, now);
    if (immediate || !current) {
      current = target; fadeFrom = target; fadeTarget = target; fadeStarted = now;
    } else {
      // Finish the old curve up to this instant before redirecting it. Repeated
      // samples of the same target must not restart the one-second fade.
      current = core.step(fadeFrom, fadeTarget, (now - fadeStarted) / 1000);
      if (target.brightness !== fadeTarget.brightness || target.warm !== fadeTarget.warm) {
        fadeFrom = current; fadeTarget = target; fadeStarted = now;
      }
      current.fresh = target.fresh;
    }
    var values = core.matrix(current);
    if (values !== lastMatrix) { matrix.setAttribute('values', values); lastMatrix = values; }
    stage.style.filter = 'url(#adaptive-art-filter)';
    var text = !enabled() ? 'Manual' : target.fresh ? Math.round(sensor.lux) + ' lux · ' + sensor.cct_kelvin + ' K' : (settings().adaptiveBrightness === 'on' ? 'Sensor unavailable · 15% brightness' : 'Sensor unavailable · manual brightness');
    var status = document.getElementById('ambient-status');
    if (status) status.textContent = text;
    var artStatus = document.getElementById('art-ambient-status');
    if (artStatus) artStatus.textContent = text;
  }
  function poll(epoch) {
    if (!running || epoch !== generation) return;
    var promise = enabled() && window.__tvBridge.readAmbient ? window.__tvBridge.readAmbient() : Promise.resolve(null);
    promise.then(function (s) {
      if (!running || epoch !== generation) return;
      if (s && !core.valid(s)) throw new Error('Invalid sensor data');
      if (s) {
        s.receivedAt = Date.now(); sensor = s; error = '';
        if (!artVisible()) paint(true);
      }
    }).catch(function (e) { if (epoch === generation) error = e.message; }).then(function () {
      if (running && epoch === generation) pollTimer = setTimeout(function () { poll(epoch); }, 3000);
    });
  }
  // Keep the last reading and output across navigation and visibility changes.
  // Its original timestamp still governs expiry; stopping does not refresh it.
  function stop() { running = false; generation++; clearTimeout(pollTimer); clearInterval(paintTimer); }
  function start() {
    // Navigation shares the app's existing sensor loop. Prepare the current
    // target synchronously before Art's first frame, without restarting polling.
    if (running) { paint(true); return; }
    stop(); if (document.hidden) return;
    // Resume at the displayed value, without counting time spent off-screen as
    // a smoothing step or snapping to the fallback before the next read arrives.
    running = true; fadeFrom = current; fadeStarted = Date.now(); paint(false); poll(generation);
    paintTimer = setInterval(function () { paint(!artVisible()); }, 16);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });
  window.addEventListener('framed:settings', function () { paint(true); });
  F.adaptive = { start: start, stop: stop, apply: function () { paint(true); },
    state: function () { return { sensor: sensor, output: current, error: error }; } };
  // Warm up on the launcher as well as Art; only app suspension pauses reads.
  start();
})(window.framed);
