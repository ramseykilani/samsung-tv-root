/*
 * framed — SLIDESHOW SEQUENCER (no DOM). Decides which library item is current and when it
 * advances. Prefs persist under "framed.slideshow":
 *   cadence     'off' | '30s' | 'hourly' | 'daily'
 *   order       'sequential' | 'shuffle'
 *   index       position in the current sequence (0-based)
 *   seed        shuffle seed (new seed each time shuffle is chosen → new deterministic order)
 *   lastAdvance ms timestamp of the last timed advance ('30s' / 'hourly' catch-up on open)
 *   lastDay     day-of-epoch the daily picture was last chosen for
 *   lastCadence last non-'off' cadence, restored by toggle()
 *
 * Daily semantics: on each app open (catchUp), if today differs from lastDay the position
 * becomes dayNumber % count — "wake up to a new picture" with only Date as a dependency.
 * Manual next/prev inside the same day sticks for that day.
 * Timed semantics: catchUp() advances by however many whole periods elapsed while the app
 * was closed, then start() ticks on the remainder.
 */
window.framed = window.framed || {};
(function (F) {
  var DAY = 86400000;
  var PERIODS = { '30s': 30000, 'hourly': 3600000 };
  var DEFAULTS = { cadence: 'off', order: 'sequential', index: 0, seed: 1, lastAdvance: 0, lastDay: 0, lastCadence: 'daily' };
  var s = F.store.merge('slideshow', {}, DEFAULTS);
  var timer = null;
  var listeners = [];

  function save(patch) { s = F.store.merge('slideshow', patch, DEFAULTS); emit(); }
  function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](s); }

  function count() { return F.library.list().length; }
  function dayNumber(now) { return Math.floor((now || Date.now()) / DAY); }

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

  function periodMs() { return PERIODS[s.cadence] || 0; }

  // Called on app open / entering Art: bring the position up to date for time that passed.
  function catchUp(now) {
    now = now || Date.now();
    var n = count(); if (!n) return;
    if (s.cadence === 'daily') {
      var d = dayNumber(now);
      if (d !== s.lastDay) save({ index: d % n, lastDay: d, lastAdvance: now });
      return;
    }
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
    if (s.cadence !== 'off' && s.lastCadence !== s.cadence) save({ lastCadence: s.cadence });
    catchUp(); schedule();
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } }
  function pause() { running = false; stop(); }

  function set(patch) {
    if (patch.order === 'shuffle' && s.order !== 'shuffle') patch.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    if (patch.cadence && patch.cadence !== 'off') patch.lastCadence = patch.cadence;
    if (patch.cadence && patch.cadence !== s.cadence) { patch.lastAdvance = Date.now(); patch.lastDay = 0; }
    save(patch);
    if (running) { catchUp(); schedule(); }
  }
  function toggle() {
    set({ cadence: s.cadence === 'off' ? (s.lastCadence || 'daily') : 'off' });
    return s.cadence;
  }

  var CADENCES = [
    { value: 'off', label: 'Off' }, { value: '30s', label: 'Every 30 s' },
    { value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }];
  var ORDERS = [{ value: 'sequential', label: 'Sequential' }, { value: 'shuffle', label: 'Shuffle' }];
  function cadenceLabel(v) { for (var i = 0; i < CADENCES.length; i++) if (CADENCES[i].value === v) return CADENCES[i].label; return v; }

  window.addEventListener('framed:library', function () { save({}); });

  F.slideshow = {
    DEFAULTS: DEFAULTS, CADENCES: CADENCES, ORDERS: ORDERS,
    get: function () { return s; }, set: set, toggle: toggle,
    position: position, current: current, sequence: sequence,
    next: next, prev: prev, goTo: goTo,
    catchUp: catchUp, start: start, pause: pause,
    cadenceLabel: cadenceLabel,
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  };
})(window.framed);
