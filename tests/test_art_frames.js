// Run with node tests/test_art_frames.js. Exercise persisted look migration and
// panel edits without a TV/browser; rendering is checked separately in Chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../framed/js/screens/art.js'), 'utf8');
function boot(saved, width = 1920, height = 1080) {
  const records = structuredClone(saved);
  let current = { id: 'one', src: 'one.jpg', title: 'One' };
  let route, subscriber, specs, change;
  const nodes = {};
  const node = id => nodes[id] ||= {
    hidden: false, style: { setProperty() {} }, classList: { add() {}, remove() {} },
    attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    getBoundingClientRect() { return {width, height}; },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  };
  const F = {
    store: {
      get(k, fallback) { return structuredClone(records[k] ?? fallback); },
      set(k, v) { records[k] = structuredClone(v); return v; }
    },
    slideshow: {
      current: () => current, subscribe(fn) { subscriber = fn; }, start() {},
      get: () => ({cadence:'off',every:1,order:'sequential'}), everyMax: () => 48,
      CADENCES: [], ORDERS: [], DEFAULTS: {cadence:'off',every:1,order:'sequential'},
      set() { subscriber(); }
    },
    adaptive: {apply() {},start() {}}, library: {list: () => [],reload() {}},
    nav: {setScope() {}}, toast() {},
    router: {register(name, r) { route = r; }},
    controls: {render(container, rows, callback) {
      specs = Object.fromEntries(rows.map(r => [r.id,r])); change = callback;
      return {get: id => specs[id]?.value, set(id,v) { if (specs[id]) specs[id].value=v; }, el: node};
    }}
  };
  vm.runInNewContext(source, {
    window: {framed:F,addEventListener() {}},
    document: {getElementById:node},
    getComputedStyle: () => ({getPropertyValue: () => '10'}),
    Image: function () {}, setTimeout() {},clearTimeout() {},setInterval() {},clearInterval() {}
  });
  route.enter();
  return {
    records, node, specs: () => specs,
    edit(id,value) { change(id,value); },
    visit(id) { current={id,src:id+'.jpg',title:id}; subscriber(); }
  };
}
for (const [old,style,color] of [
  [{frame:'none'},'none',''], [{frame:'black'},'thin','black'],
  [{frame:'gold',light:'right'},'thin','gold'], [{frame:'float'},'gap','black'],
  [{moulding:'walnut',mount:'fillet'},'thin','gold']
]) {
  const app=boot({art:{...old,drift:'off'},artPer:{one:{...old,drift:'on'}}});
  assert.equal(app.specs().style.value,style);
  assert.equal(app.specs().color.value,color);
  assert.equal(app.specs().drift.value,'on');
  app.visit('unset');
  assert.equal(app.specs().style.value,style);
  assert.equal(app.specs().drift.value,'off');
}
const app=boot({art:{frame:'gold',drift:'off'},artPer:{one:{frame:'float',drift:'on'},two:{frame:'none',drift:'off'}}});
app.edit('style','wood'); app.edit('color','oak');
assert.equal(app.records.artPer.one.style,'wood');
assert.equal(app.records.artPer.one.color,'oak');
assert.equal(app.records.artPer.one.drift,'on');
assert.equal(app.records.artPer.two.frame,'none');
app.visit('two');
assert.equal(app.specs().style.value,'none');
assert.equal(app.specs().color.hidden,true);
assert.equal(app.specs().drift.value,'off');
app.visit('unset');
assert.equal(app.specs().style.value,'wood');
assert.equal(app.specs().color.value,'oak');
app.edit('style','thin'); app.edit('style','wood');
assert.equal(app.specs().color.value,'oak');
const restart=boot(app.records);
assert.equal(restart.specs().style.value,'wood');
assert.equal(restart.specs().color.value,'oak');
restart.edit('reset',true);
assert.equal(restart.specs().style.value,'thin');
assert.equal(restart.specs().color.value,'black');
assert.equal(restart.records.artPer.two.frame,'none');
assert.equal(restart.specs().light,undefined);
console.log('Art frames: legacy migration, per-picture persistence, inherited look, colour memory, Pixel shift and scoped Reset passed.');

for (const [width,height,margin] of [[1920,1080,3],[3840,2160,6]]) {
  const shifted=boot({art:{style:'none',drift:'on'}},width,height);
  const stage=shifted.node('art-stage');
  for (const side of ['top','bottom','left','right']) assert.equal(stage.style[side],margin+'px');
  const offsets=stage.style.transform.match(/-?[\d.]+/g).map(Number);
  assert(offsets.every(v => Math.abs(v)<=margin));
  shifted.edit('drift','off');
  for (const side of ['top','bottom','left','right','transform']) assert.equal(stage.style[side],'');
  shifted.edit('drift','on');
  assert.equal(stage.style.top,margin+'px');
}
console.log('Pixel shift: six 4K pixels, CSS scaling, positive safety margin and Off restoration passed.');
