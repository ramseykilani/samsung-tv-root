// Run with: node tests/test_media_subtitles.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = 'https://opensubtitles-v3.strem.io';
function setup({disabled = [], local = null, manifest, failure = false} = {}) {
  const requests = [];
  const prefs = {disabledAddons: disabled};
  const framed = {store: {get(key, fallback) {return key === 'media' ? prefs : fallback;}, set() {}}};
  vm.runInNewContext(fs.readFileSync('framed/js/media.js', 'utf8'), {
    window: {framed}, console: {info() {}},
    XMLHttpRequest: function () {
      this.open = (method, url) => {this.url = url;};
      this.send = () => {
        requests.push(this.url);
        if (failure && this.url.includes('/subtitles/')) return this.ontimeout();
        let data = null;
        if (this.url === 'addons.local.json') data = local;
        else if (this.url === base + '/manifest.json' || this.url === 'https://custom.test/manifest.json') {
          data = manifest || {id: 'opensubtitles', resources: ['subtitles'], types: ['movie', 'series'], idPrefixes: ['tt']};
        } else if (this.url.includes('/subtitles/')) {
          data = {subtitles: [{lang: 'eng', url: 'https://subs.test/file.srt'}, {lang: 'fra'}]};
        } else data = {id: 'other', resources: ['catalog'], types: ['movie']};
        this.status = 200;
        this.responseText = JSON.stringify(data);
        this.onload();
      };
    }
  });
  return {media: framed.media, requests};
}
function lookup(env, type, id) {
  let result, calls = 0;
  env.media.subtitles(type, id, subs => {result = subs; calls++;});
  assert.equal(calls, 1, 'lookup finishes exactly once');
  return result;
}
let env = setup();
assert.equal(lookup(env, 'movie', 'tt1234')[0].addon, 'OpenSubtitles v3');
assert(env.requests.includes(base + '/subtitles/movie/tt1234.json'));
assert.equal(lookup(env, 'series', 'tt1234:2:3').length, 1, 'ignore entries without a URL');
assert(env.requests.includes(base + '/subtitles/series/tt1234%3A2%3A3.json'));
env = setup();
assert.equal(lookup(env, 'movie', 'demo:1').length, 0);
assert(!env.requests.some(url => url.includes('/subtitles/')), 'skip unsupported IDs');
env = setup({manifest: {id: 'subs', resources: [{name: 'subtitles', types: ['series'], idPrefixes: ['tt']}], types: ['movie', 'series']}});
assert.equal(lookup(env, 'movie', 'tt1234').length, 0, 'respect resource-specific types');
assert.equal(lookup(env, 'series', 'tt1234:1:1').length, 1);
env = setup({disabled: ['OpenSubtitles v3']});
assert.equal(lookup(env, 'movie', 'tt1234').length, 0);
assert(!env.requests.some(url => url.startsWith(base)), 'respect disabled provider');
env = setup({local: {addons: [{name: 'OpenSubtitles v3', base: 'https://custom.test'}]}});
assert.equal(lookup(env, 'movie', 'tt1234').length, 1);
assert(env.requests.includes('https://custom.test/subtitles/movie/tt1234.json'), 'load local override before lookup');
env = setup({failure: true});
assert.equal(lookup(env, 'movie', 'tt1234').length, 0, 'provider timeout completes with no subtitles');
env = setup();
assert.equal(lookup(env, 'movie', '').length, 0);
assert.equal(env.requests.length, 0);
console.log('Subtitle checks passed: default provider, episodes, restrictions, disable, override and timeout.');
