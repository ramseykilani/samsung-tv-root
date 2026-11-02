/* framed — tiny namespaced localStorage store with in-memory fallback. */
window.framed = window.framed || {};
(function (F) {
  var PREFIX = 'framed.';
  var mem = {};
  var ok = (function () {
    try { localStorage.setItem(PREFIX + '__probe', '1'); localStorage.removeItem(PREFIX + '__probe'); return true; }
    catch (e) { return false; }
  })();

  F.store = {
    get: function (key, fallback) {
      var raw = ok ? localStorage.getItem(PREFIX + key) : mem[key];
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      if (ok) localStorage.setItem(PREFIX + key, raw); else mem[key] = raw;
      return value;
    },
    merge: function (key, patch, defaults) {
      var cur = F.store.get(key, {});
      var out = {};
      var k;
      for (k in defaults) if (defaults.hasOwnProperty(k)) out[k] = defaults[k];
      for (k in cur) if (cur.hasOwnProperty(k)) out[k] = cur[k];
      for (k in patch) if (patch.hasOwnProperty(k)) out[k] = patch[k];
      return F.store.set(key, out);
    },
    persistent: ok
  };
})(window.framed);
