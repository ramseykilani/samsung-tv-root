/* Pure policy, independent of DOM and transport. This is our response curve,
 * not a claim to reproduce Samsung's proprietary white-balance calibration. */
(function (root) {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function number(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function valid(s) {
    return s && typeof s.lux === 'number' && isFinite(s.lux) && s.lux >= 0 && s.lux <= 1000 &&
      typeof s.cct_kelvin === 'number' && isFinite(s.cct_kelvin) && s.cct_kelvin >= 2700 && s.cct_kelvin <= 6500;
  }
  // Original shifted power fit retained from 12.5 lux upward.
  // Fit weights: 3 each at 4.5/12.5/27.5 lux, 1 at 213, 0.5 at 586
  // (direct lamp, provisional). Rounded fit: shift 1.18, exponent 0.336.
  // Percentages use the same scale as the manual slider.
  function gain(percent) { return 0.02 + 0.98 * clamp(percent, 0, 100) / 100; }
  function fittedPercent(lux) {
    return 5 * Math.pow((lux - 1.18) / 0.82, 0.336);
  }
  function autoPercent(lux) {
    if (lux <= 5) return Math.max(1, lux);
    if (lux < 12.5) {
      // Cubic Hermite join: match both value and slope at 5 and 12.5 lux.
      var t = (lux - 5) / 7.5, t2 = t * t, t3 = t2 * t;
      var end = fittedPercent(12.5), endSlope = end * 0.336 / (12.5 - 1.18);
      return (2*t3 - 3*t2 + 1) * 5 + (t3 - 2*t2 + t) * 7.5 +
        (-2*t3 + 3*t2) * end + (t3 - t2) * 7.5 * endSlope;
    }
    return clamp(fittedPercent(lux), 1, 100);
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
  // One-second smoothstep: fractional gains, with gentle starts and stops.
  function step(previous, next, elapsed) {
    var t = clamp(elapsed, 0, 1);
    var a = t * t * (3 - 2 * t);
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
