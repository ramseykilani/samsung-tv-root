(function (F) {
  var core = F.adaptiveCore, sensor = null, running = false, generation = 0;
  var pollTimer = null, paintTimer = null, previousTime = 0, current = null, error = '';
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
    current = immediate || !current ? target : core.step(current, target, (now - previousTime) / 1000);
    previousTime = now;
    matrix.setAttribute('values', core.matrix(current));
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
    running = true; previousTime = Date.now(); paint(false); poll(generation);
    paintTimer = setInterval(function () { paint(!artVisible()); }, 250);
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
