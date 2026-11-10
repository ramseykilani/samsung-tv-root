const assert = require('node:assert/strict');
const core = require('../framed/js/adaptive-core.js');
const s = { brightness:100, artFloor:0, adaptiveBrightness:'on', adaptiveTone:'on' };
const sample = (lux,cct=4500) => ({lux,cct_kelvin:cct,color_reliable:lux>=5,receivedAt:1000});
const gain = p => 0.02 + 0.98 * p / 100;
for (const [lux, percent] of [[0,1],[0.5,1],[1,1],[2,2],[3,3],[4,4],[4.5,4.5],[5,5]]) {
  assert.equal(core.target(s,sample(lux),1000).brightness, gain(percent));
}
// A smooth fit should stay close to observations, without hitting every noisy point.
for (const [lux, percent] of [[12.5,13],[27.5,15],[213,33],[586,45]]) {
  const actual = (core.target(s,sample(lux),1000).brightness - 0.02) / 0.98 * 100;
  assert(Math.abs(actual - percent) < 1.2);
}
// The original fit is preserved above the low-light transition.
let previousSlope = Infinity;
for (let lux = 12.5; lux < 1000; lux += 0.25) {
  assert.equal(core.target(s,sample(lux),1000).brightness,
    gain(5 * Math.pow((lux - 1.18) / 0.82, 0.336)));
  const slope = (core.target(s,sample(lux + 0.001),1000).brightness -
    core.target(s,sample(lux),1000).brightness) / 0.001;
  assert(slope > 0 && slope <= previousSlope);
  previousSlope = slope;
}
let previous = 0;
for (let lux=0; lux<=1000; lux+=0.01) {
  const output=core.target(s,sample(lux),1000).brightness;
  assert(output >= previous && output >= gain(1) && output <= 1);
  assert.equal(output, core.target({...s,brightness:0,artFloor:100},sample(lux),1000).brightness);
  previous=output;
}
assert(previous > gain(45) && previous < gain(60));
// Both joins are continuous in value and slope (the minimum has a deliberate corner).
for (const lux of [5,12.5]) {
  const at = x => core.target(s,sample(x),1000).brightness;
  const epsilon = 0.0001;
  assert(Math.abs(at(lux + epsilon) - at(lux - epsilon)) < 0.00001);
  const left = (at(lux) - at(lux - epsilon)) / epsilon;
  const right = (at(lux + epsilon) - at(lux)) / epsilon;
  assert(Math.abs(left - right) < 0.000001);
}
assert.equal(core.target({...s,adaptiveBrightness:'off',brightness:0},sample(0),1000).brightness,gain(0));
assert(core.target(s,sample(20),1000).brightness < core.target(s,sample(100),1000).brightness);
assert(core.target(s,sample(20,3000),1000).warm > core.target(s,sample(20,6000),1000).warm);
assert.equal(core.target(s,sample(0,2700),1000).warm,0);
assert.equal(core.target(s,sample(20),14000).brightness,gain(15));
assert.equal(core.target(s,sample(20),14000).warm,0);
assert.equal(core.target(s,null,1000).brightness,gain(15));
assert.equal(core.target({...s,adaptiveBrightness:'off'},sample(0),1000).brightness,1);
assert.equal(core.target({...s,adaptiveTone:'off'},sample(20),1000).warm,0);
assert.equal(core.target({...s,adaptiveBrightness:'off',brightness:5},sample(213),1000).brightness,gain(5));
assert.equal(core.target({...s,brightness:0},null,1000).brightness,gain(15));
assert.equal(core.valid(sample(NaN)),false);
assert.equal(core.valid(sample(10,Infinity)),false);
const after = core.step({brightness:1,warm:0},{brightness:0.02,warm:0.5,fresh:true},1);
assert(after.brightness>0.02 && after.brightness<1);
assert(after.warm>0 && after.warm<0.5);
assert.equal(core.matrix(after).split(' ').length,20);
console.log('Adaptive policy: darkness, CCT, manual independence, stale data and smoothing passed.');
