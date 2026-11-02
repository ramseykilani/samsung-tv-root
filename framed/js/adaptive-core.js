/* Pure policy, independent of DOM and transport. This is our response curve,
 * not a claim to reproduce Samsung's proprietary white-balance calibration. */
(function (root) {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function number(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function valid(s) {
    return s && typeof s.lux === 'number' && isFinite(s.lux) && s.lux >= 0 && s.lux <= 1000 &&
      typeof s.cct_kelvin === 'number' && isFinite(s.cct_kelvin) && s.cct_kelvin >= 2700 && s.cct_kelvin <= 6500;
  }
  function target(settings, sensor, now) {
    var ceiling = 0.02 + 0.98 * clamp(number(settings.brightness, 100), 0, 100) / 100;
    var fresh = valid(sensor) && typeof sensor.receivedAt === 'number' && now - sensor.receivedAt >= 0 && now - sensor.receivedAt <= 12000;
    var brightness = ceiling, warm = 0;
    if (fresh && settings.adaptiveBrightness === 'on') {
      var floor = Math.min(ceiling, Math.max(0.02, clamp(number(settings.artFloor, 10), 0, 100) / 100));
      var fraction = Math.pow(clamp((sensor.lux - 2) / 498, 0, 1), 0.6);
      brightness = floor + (ceiling - floor) * fraction;
    }
    if (fresh && settings.adaptiveTone === 'on' && sensor.color_reliable && sensor.lux >= 5) {
      warm = clamp((6500 - sensor.cct_kelvin) / 3800, 0, 1) * 0.7;
    }
    return { brightness: brightness, warm: warm, fresh: !!fresh };
  }
  function step(previous, next, dt) {
    var a = 1 - Math.exp(-clamp(dt, 0, 2) / 3);
    return { brightness: previous.brightness + a * (next.brightness - previous.brightness),
      warm: previous.warm + a * (next.warm - previous.warm), fresh: next.fresh };
  }
  function matrix(v) {
    var k = v.brightness;
    return [k,0,0,0,0, 0,k*(1-0.18*v.warm),0,0,0, 0,0,k*(1-0.45*v.warm),0,0, 0,0,0,1,0].join(' ');
  }
  var api = { target: target, step: step, matrix: matrix, valid: valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.framed = root.framed || {}; root.framed.adaptiveCore = api; }
})(typeof window !== 'undefined' ? window : this);
