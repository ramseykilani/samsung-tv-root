/* Pure policy, independent of DOM and transport. This is our response curve,
 * not a claim to reproduce Samsung's proprietary white-balance calibration. */
(function (root) {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function number(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function valid(s) {
    return s && typeof s.lux === 'number' && isFinite(s.lux) && s.lux >= 0 && s.lux <= 1000 &&
      typeof s.cct_kelvin === 'number' && isFinite(s.cct_kelvin) && s.cct_kelvin >= 2700 && s.cct_kelvin <= 6500;
  }
  // Smooth shifted power fit to room measurements, anchored at 2 lux = 5%.
  // Fit weights: 3 each at 4.5/12.5/27.5 lux, 1 at 213, 0.5 at 586
  // (direct lamp, provisional). Rounded fit: shift 1.18, exponent 0.336.
  // Percentages use the same scale as the manual slider.
  function gain(percent) { return 0.02 + 0.98 * clamp(percent, 0, 100) / 100; }
  function autoPercent(lux) {
    if (lux <= 2) return 5;
    return clamp(5 * Math.pow((lux - 1.18) / 0.82, 0.336), 5, 100);
  }
  function target(settings, sensor, now) {
    var manual = gain(number(settings.brightness, 100));
    var fresh = valid(sensor) && typeof sensor.receivedAt === 'number' && now - sensor.receivedAt >= 0 && now - sensor.receivedAt <= 12000;
    // Auto never depends on a hidden manual value, including sensor failure.
    // A missing/stale sensor uses a modest 15% fallback until readings return.
    var brightness = settings.adaptiveBrightness === 'on' ? gain(fresh ? autoPercent(sensor.lux) : 15) : manual;
    var warm = 0;
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
