const assert = require('node:assert/strict');
const core = require('../framed/js/adaptive-core.js');
const s = { brightness:100, artFloor:0, adaptiveBrightness:'on', adaptiveTone:'on' };
const sample = (lux,cct=4500) => ({lux,cct_kelvin:cct,color_reliable:lux>=5,receivedAt:1000});
assert.equal(core.target(s,sample(0),1000).brightness,0.069);
const gain = p => 0.02 + 0.98 * p / 100;
for (const [lux, percent] of [[0,5],[2,5],[4.5,8],[12.5,13],[27.5,15],[213,33],[586,45]]) {
  assert(Math.abs(core.target(s,sample(lux),1000).brightness - gain(percent)) < 1e-10);
}
let previous = 0;
for (let lux=0; lux<=1000; lux++) {
  const output=core.target(s,sample(lux),1000).brightness;
  assert(output >= previous && output >= gain(5) && output <= 1);
  assert.equal(output, core.target({...s,brightness:0,artFloor:100},sample(lux),1000).brightness);
  previous=output;
}
assert(previous > gain(45) && previous < gain(60));
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
