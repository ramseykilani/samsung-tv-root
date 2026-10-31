/*
 * framed — SLIDESHOW SEQUENCER (no DOM). Decides which library item is current and when it
 * advances. Prefs persist under "framed.slideshow":
 *   cadence     'off' | 'hours' | 'days'
 *   every       interval in the cadence's unit (1..48 hours, 1..30 days)
 *   order       'sequential' | 'shuffle'
 *   index       position in the current sequence (0-based)
 *   seed        shuffle seed (new seed each time shuffle is chosen → new deterministic order)
 *   lastAdvance ms timestamp of the last timed advance (catch-up on open)
 *   lastCadence / lastEvery   last non-'off' rotation, restored by toggle()
 *
 * Timed semantics: catchUp() advances by however many whole periods elapsed while the app
 * was closed, then start() ticks on the remainder. A manual next/prev restarts the period.
 * Scaffold-era prefs ('30s' | 'hourly' | 'daily', and the daily-only lastDay key) are migrated
 * on load: hourly → every 1 hour, daily → every 1 day, 30s → every 1 hour.
 */
window.framed = window.framed || {};
(function (F) {
  var HOUR = 3600000, DAY = 86400000;
  var UNITS = { hours: HOUR, days: DAY };
  var MAX_EVERY = { hours: 48, days: 30 };
  var DEFAULTS = { cadence: 'off', every: 1, order: 'sequential', index: 0, seed: 1, lastAdvance: 0, lastCadence: 'days', lastEvery: 1 };
  var timer = null;
  var listeners = [];

  var s = (function () {
    var raw = F.store.get('slideshow', {}) || {};
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    var oldCadences = { '30s': 'hours', hourly: 'hours', daily: 'days' };
    if (raw.cadence === 'off' || raw.cadence === 'hours' || raw.cadence === 'days') out.cadence = raw.cadence;
    else if (oldCadences[raw.cadence]) out.cadence = oldCadences[raw.cadence];
    if (raw.every >= 1) out.every = Math.round(raw.every);
    if (raw.order === 'shuffle' || raw.order === 'sequential') out.order = raw.order;
    if (typeof raw.index === 'number') out.index = raw.index;
    if (typeof raw.seed === 'number') out.seed = raw.seed;
    if (typeof raw.lastAdvance === 'number') out.lastAdvance = raw.lastAdvance;
    if (raw.lastCadence === 'hours' || raw.lastCadence === 'days') out.lastCadence = raw.lastCadence;
    else if (oldCadences[raw.lastCadence]) out.lastCadence = oldCadences[raw.lastCadence];
    if (raw.lastEvery >= 1) out.lastEvery = Math.round(raw.lastEvery);
    F.store.set('slideshow', out); // drops scaffold keys (lastDay, old cadence names)
    return out;
  })();

  function save(patch) { s = F.store.merge('slideshow', patch, DEFAULTS); emit(); }
  function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](s); }

  function count() { return F.library.list().length; }

  // mulberry32 — small deterministic PRNG so a shuffle order survives reload
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // sequence: array of library indices in display order
  function sequence() {
    var n = count(), seq = [], i;
    for (i = 0; i < n; i++) seq.push(i);
    if (s.order === 'shuffle' && n > 1) {
      var r = rng(s.seed);
      for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = seq[i]; seq[i] = seq[j]; seq[j] = t; }
    }
    return seq;
  }

  function pos() { var n = count(); return n ? ((s.index % n) + n) % n : 0; }
  function current() {
    var list = F.library.list();
    if (!list.length) return null;
    return list[sequence()[pos()]];
  }
  function position() { return { index: pos(), count: count(), item: current() }; }

  function goTo(p, opts) {
    var n = count(); if (!n) return;
    var patch = { index: ((p % n) + n) % n };
    if (!(opts && opts.timed)) patch.lastAdvance = Date.now(); // manual move restarts the period
    save(patch);
    schedule();
  }
  function next(opts) { goTo(pos() + 1, opts); }
  function prev(opts) { goTo(pos() - 1, opts); }

  function periodMs() {
    var unit = UNITS[s.cadence];
    return unit ? s.every * unit : 0;
  }

  // Called on app open / entering Art: bring the position up to date for time that passed.
  function catchUp(now) {
    now = now || Date.now();
    var n = count(); if (!n) return;
    var p = periodMs();
    if (!p) return;
    if (!s.lastAdvance) { save({ lastAdvance: now }); return; }
    var steps = Math.floor((now - s.lastAdvance) / p);
    if (steps > 0) save({ index: (pos() + steps) % n, lastAdvance: s.lastAdvance + steps * p });
  }

  function schedule() {
    stop();
    if (!running) return;
    var p = periodMs(); if (!p) return;
    var due = Math.max(50, (s.lastAdvance || Date.now()) + p - Date.now());
    timer = setTimeout(function () {
      save({ index: (pos() + 1) % Math.max(1, count()), lastAdvance: Date.now() });
      schedule();
    }, due);
  }
  var running = false;
  function start() {
    running = true;
    if (s.cadence !== 'off' && (s.lastCadence !== s.cadence || s.lastEvery !== s.every)) {
      save({ lastCadence: s.cadence, lastEvery: s.every });
    }
    catchUp(); schedule();
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } }
  function pause() { running = false; stop(); }

  function set(patch) {
    if (patch.order === 'shuffle' && s.order !== 'shuffle') patch.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    var nextCadence = patch.cadence || s.cadence;
    if (patch.cadence && patch.cadence !== 'off') {
      patch.lastCadence = patch.cadence;
      patch.lastEvery = patch.every >= 1 ? Math.round(patch.every) : s.every;
    }
    // cap the interval at the unit's range (switching 36 hours → days must not keep 36)
    var cap = MAX_EVERY[nextCadence] || 48;
    if ((patch.every || s.every) > cap) patch.every = cap;
    if ((patch.cadence && patch.cadence !== s.cadence) || (patch.every && patch.every !== s.every)) {
      patch.lastAdvance = Date.now();
    }
    save(patch);
    if (running) { catchUp(); schedule(); }
  }
  function toggle() {
    if (s.cadence === 'off') set({ cadence: s.lastCadence || 'days', every: s.lastEvery || 1 });
    else set({ cadence: 'off' });
    return s.cadence;
  }

  var CADENCES = [
    { value: 'off', label: 'Off' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' }
  ];
  var ORDERS = [{ value: 'sequential', label: 'Sequential' }, { value: 'shuffle', label: 'Shuffle' }];
  function cadenceLabel(st) {
    st = st || s;
    if (st.cadence === 'off') return 'Off';
    var unit = st.cadence === 'days' ? (st.every === 1 ? 'day' : 'days') : (st.every === 1 ? 'hour' : 'hours');
    return 'Every ' + st.every + ' ' + unit;
  }
  function everyMax(st) { return MAX_EVERY[(st || s).cadence] || 48; }

  window.addEventListener('framed:library', function () { save({}); });

  F.slideshow = {
    DEFAULTS: DEFAULTS, CADENCES: CADENCES, ORDERS: ORDERS,
    get: function () { return s; }, set: set, toggle: toggle,
    position: position, current: current, sequence: sequence,
    next: next, prev: prev, goTo: goTo,
    catchUp: catchUp, start: start, pause: pause,
    cadenceLabel: cadenceLabel, everyMax: everyMax,
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  };
})(window.framed);
