/* Pure policy, independent of DOM and transport. This is our response curve,
 * not a claim to reproduce Samsung's proprietary white-balance calibration. */
(function (root) {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function number(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function valid(s) {
    return s && typeof s.lux === 'number' && isFinite(s.lux) && s.lux >= 0 && s.lux <= 1000 &&
      typeof s.cct_kelvin === 'number' && isFinite(s.cct_kelvin) && s.cct_kelvin >= 2700 && s.cct_kelvin <= 6500;
  }
  // Percentages use the same scale as the manual slider. Room calibration:
  // low-light readings are strongest; 586 lux was a direct lamp, provisional.
  var points = [[2, 5], [4.5, 8], [12.5, 13], [27.5, 15], [213, 33], [586, 45]];
  function gain(percent) { return 0.02 + 0.98 * clamp(percent, 0, 100) / 100; }
  function autoPercent(lux) {
    if (lux <= points[0][0]) return points[0][1];
    var i = 1;
    while (i < points.length - 1 && lux > points[i][0]) i++;
    var a = points[i - 1], b = points[i];
    // Continue the last gentle slope above the measured range (58% at 1000 lux).
    return clamp(a[1] + (b[1] - a[1]) * (lux - a[0]) / (b[0] - a[0]), 5, 100);
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
