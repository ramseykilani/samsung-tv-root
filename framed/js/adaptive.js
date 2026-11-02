(function (F) {
  var core = F.adaptiveCore, sensor = null, running = false, generation = 0;
  var pollTimer = null, paintTimer = null, previousTime = 0, current = null, error = '';
  var matrix = document.getElementById('adaptive-color-matrix');
  var stage = document.getElementById('art-stage');
  function settings() { return F.store.get('settings', {}); }
  function enabled() { var s = settings(); return s.adaptiveBrightness === 'on' || s.adaptiveTone === 'on'; }
  function paint(immediate) {
    var now = Date.now(), target = core.target(settings(), sensor, now);
    current = immediate || !current ? target : core.step(current, target, (now - previousTime) / 1000);
    previousTime = now;
    matrix.setAttribute('values', core.matrix(current));
    stage.style.filter = 'url(#adaptive-art-filter)';
    var text = !enabled() ? 'Manual' : target.fresh ? Math.round(sensor.lux) + ' lux · ' + sensor.cct_kelvin + ' K' : 'Sensor unavailable · manual brightness';
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
      if (s) { s.receivedAt = Date.now(); sensor = s; error = ''; }
    }).catch(function (e) { if (epoch === generation) error = e.message; }).then(function () {
      if (running && epoch === generation) pollTimer = setTimeout(function () { poll(epoch); }, 3000);
    });
  }
  function stop() { running = false; generation++; clearTimeout(pollTimer); clearInterval(paintTimer); sensor = null; }
  function start() {
    stop(); if (document.hidden) return;
    running = true; previousTime = Date.now(); paint(true); poll(generation);
    paintTimer = setInterval(function () { paint(false); }, 250);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (location.hash === '#/art') start();
  });
  window.addEventListener('framed:settings', function () { paint(true); });
  F.adaptive = { start: start, stop: stop, apply: function () { paint(true); },
    state: function () { return { sensor: sensor, output: current, error: error }; } };
})(window.framed);
