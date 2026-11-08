// Run with node tests/test_screensaver.js; no TV required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../framed/js/bridge.tizen.js'), 'utf8');
function boot({ native = true, fail = false } = {}) {
  const calls = [], timers = new Map(), events = {}, warnings = [];
  let id = 0;
  const api = {
    AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 'OFF', SCREEN_SAVER_ON: 'ON' },
    setScreenSaver(state, success, error) {
      calls.push(state);
      if (fail === 'throw') throw new Error('API failure');
      if (fail) error(new Error('API failure')); else success();
    }
  };
  const document = { hidden: false, addEventListener(name, fn) { events[name] = fn; } };
  const window = {
    tizen: native ? {} : undefined,
    webapis: native ? { appcommon: api } : undefined,
    addEventListener(name, fn) { events[name] = fn; }
  };
  vm.runInNewContext(source, {
    window, document, console: { warn(...args) { warnings.push(args); } },
    setInterval(fn, delay) { assert.equal(delay, 60000); timers.set(++id, fn); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  return { window, document, calls, timers, warnings, events,
    active(value) { window.__tvBridge.setArtActive(value); },
    tick() { for (const fn of timers.values()) fn(); },
    hidden(value) { document.hidden = value; events.visibilitychange(); },
    recover() { fail = false; }
  };
}
const app = boot();
assert.deepEqual(app.calls, []); // Launcher never suppresses idle behavior.
app.active(true);
assert.deepEqual(app.calls, ['OFF']);
app.active(true);
assert.equal(app.timers.size, 1);
for (let minute = 0; minute < 12 * 60; minute++) app.tick();
assert.ok(app.calls.every(state => state === 'OFF'));
app.hidden(true);
assert.equal(app.calls.at(-1), 'ON');
assert.equal(app.timers.size, 0);
app.hidden(false);
assert.equal(app.calls.at(-1), 'OFF');
app.active(false);
assert.equal(app.calls.at(-1), 'ON');
assert.equal(app.timers.size, 0);
const count = app.calls.length;
app.hidden(true); app.hidden(false);
assert.equal(app.calls.length, count);
app.active(true);
app.events.pagehide();
assert.equal(app.calls.at(-1), 'ON');
assert.equal(app.timers.size, 0);
app.events.pageshow();
assert.equal(app.calls.at(-1), 'OFF');
app.hidden(true);
app.active(false);
app.hidden(false);
assert.equal(app.calls.at(-1), 'ON');
for (const fail of [true, 'throw']) {
  const broken = boot({ fail });
  broken.active(true); broken.tick();
  assert.equal(broken.warnings.length, 1);
  broken.recover(); broken.tick();
  assert.equal(broken.calls.at(-1), 'OFF');
  broken.active(false);
  assert.equal(broken.calls.at(-1), 'ON');
}
const desktop = boot({ native: false });
desktop.active(true); desktop.tick(); desktop.hidden(true); desktop.active(false);
assert.deepEqual(desktop.calls, []);
assert.deepEqual(desktop.warnings, []);
const late = boot();
const webapis = late.window.webapis;
delete late.window.webapis;
late.active(true);
late.window.webapis = webapis;
late.tick();
assert.deepEqual(late.calls, ['OFF']);
late.active(false);

const manifest = fs.readFileSync(require.resolve('../framed/config.xml'), 'utf8');
assert.ok(manifest.includes('http://developer.samsung.com/privilege/appcommon'));
console.log('Screensaver: overnight renewal, foreground/background, route exit, page lifecycle, failures and desktop fallback passed.');
