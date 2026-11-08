const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const requests = [], probes = [], events = [];
const window = {framed: {}, dispatchEvent: e => events.push(e)};
const context = {
  window, console, setTimeout, clearTimeout,
  CustomEvent: function (type) { this.type = type; },
  Image: function () { probes.push(this); },
  XMLHttpRequest: function () {
    requests.push(this);
    this.open = () => {};
    this.send = () => {};
  }
};
vm.runInNewContext(fs.readFileSync('framed/js/library.js', 'utf8')
  .replace("var REMOTE_ART_BASE = ''", "var REMOTE_ART_BASE = 'http://art/'"), context);
const lib = window.framed.library;
const images = ['a', 'b', 'c'].map(file => ({file: file + '.jpg', version: '1'}));
function respond(images) {
  const req = requests.at(-1);
  req.status = 200;
  req.responseText = JSON.stringify({images});
  req.onload();
}
function loaded(probe, width = 1600, height = 900) {
  probe.naturalWidth = width;
  probe.naturalHeight = height;
  probe.onload();
}
lib.reload();
assert.equal(requests.length, 1, 'coalesce concurrent refreshes');
respond(images);
assert.equal(probes.length, 2, 'bound concurrent dimension probes');
loaded(probes[1]); // deliberately finish out of order
assert.equal(probes.length, 3);
loaded(probes[2], 900, 1600); // rejected dimensions are cached too
loaded(probes[0]);
assert.equal(lib.list().map(it => it.id).join(','), 'remote:a.jpg,remote:b.jpg');
assert.equal(lib.rejected(), 1);
lib.reload();
respond(images);
assert.equal(probes.length, 3, 'unchanged refresh must not reload images');
assert.equal(events.length, 1, 'unchanged refresh must not rebuild listeners');
lib.reload();
respond([{...images[0], version: '2'}, images[1], images[2]]);
assert.equal(probes.length, 4, 'replaced artwork gets rechecked');
loaded(probes[3]);
assert(lib.list()[0].src.endsWith('?v=2'));
lib.reload();
respond([{...images[0], version: '2', title: 'Renamed'}, images[1], images[2]]);
assert.equal(lib.list()[0].title, 'Renamed');
assert.equal(probes.length, 4);
console.log('Library: bounded loads, stable order, cache reuse, rejection and replacement passed.');
