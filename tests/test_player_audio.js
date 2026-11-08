// Run with node tests/test_player_audio.js (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../framed');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    await page.evaluate(() => {
      window.attempts = [];
      window.notices = [];
      window.failSwitch = true;
      window.tizen = {};
      window.webapis = { avplay: {
        getTotalTrackInfo: () => [
          { type: 'VIDEO', index: 0 },
          { type: 'AUDIO', index: 2, extra_info: '{"track_lang":"English","codec":"DTS"}' },
          { type: 'AUDIO', index: 5, extra_info: '{"track_lang":"French","codec":"AAC"}' }
        ],
        getCurrentStreamInfo: () => [{ type: 'AUDIO', index: 2 }],
        setSelectTrack: (type, index) => {
          window.attempts.push(index);
          if (window.failSwitch) throw new Error('InvalidStateError');
        },
        stop() {}, open() {}, setDisplayRect() {}, setListener() {}, prepareAsync(done) { done(); }, play() {},
        getDuration: () => 120000
      } };
      window.framed = {
        nav: { focus: el => el.focus(), setScope() {} },
        router: { register() {} },
        media: { prefs: () => ({ subSize: 100, autoplayNext: false }) },
        toast: message => window.notices.push(message)
      };
      document.getElementById('screen-media-play').hidden = false;
    });
    await page.addScriptTag({ path: path.join(root, 'js/engine.js') });
    await page.evaluate(() => {
      const attach = framed.engine.attach;
      framed.engine.attach = video => (window.engine = attach(video));
    });
    await page.addScriptTag({ path: path.join(root, 'js/controls.js') });
    await page.addScriptTag({ path: path.join(root, 'js/screens/media-play.js') });
    await page.click('#mp-sound');
    const french = '#mp-ctl-play [data-control-id="sound"] [data-value="1"]';
    const selected = () => page.locator('#mp-ctl-play [data-control-id="sound"] [data-selected="true"]').textContent();
    await page.click(french);
    assert.equal(await selected(), 'English', 'failed switch must restore the actual selection');
    assert.equal(await page.locator('#mp-sound .act__value').textContent(), 'English');
    assert.equal(await page.evaluate(() => notices.length), 1, 'failure must be visible');
    await page.evaluate(() => { failSwitch = false; });
    await page.click(french);
    assert.deepEqual(await page.evaluate(() => attempts), [5, 5], 'same option must retry using the native track index');
    assert.equal(await selected(), 'French');
    assert.equal(await page.locator('#mp-sound .act__value').textContent(), 'French');
    await page.click(french);
    assert.equal(await page.evaluate(() => attempts.length), 2, 'successful selection remains a no-op');
    // Remote adjustment must also restore selection on failure and allow retry.
    await page.evaluate(() => { failSwitch = true; });
    const adjust = () => page.locator('#mp-ctl-play [data-control-id="sound"]').evaluate(el => el.dispatchEvent(new CustomEvent('framed:adjust', { detail: { delta: -1 } })));
    await adjust();
    assert.equal(await selected(), 'French');
    await page.evaluate(() => { failSwitch = false; });
    await adjust();
    assert.equal(await selected(), 'English');
    // Automatic DTS fallback must leave exactly one enabled track.
    await page.evaluate(() => { engine.open('test://movie'); engine.play(); });
    assert.deepEqual(await page.evaluate(() => engine.audioTracks().map(t => t.enabled)), [false, true]);
    assert.equal(await page.evaluate(() => engine.selectAudio(99)), false);
    // HTML5 backend: invalid selection must not disable all audio.
    assert.deepEqual(await page.evaluate(() => {
      delete window.tizen;
      const video = { audioTracks: [{ enabled: true }, { enabled: false }] };
      const backend = framed.engine.attach(video);
      const invalid = backend.selectAudio(9);
      const before = video.audioTracks.map(t => t.enabled);
      const valid = backend.selectAudio(1);
      return { invalid, before, valid, after: video.audioTracks.map(t => t.enabled) };
    }), { invalid: false, before: [true, false], valid: true, after: [false, true] });
    assert.deepEqual(errors, []);
    console.log('Player audio: failed click, same-option retry, remote retry, native indices, DTS fallback and HTML5 selection passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
