// Run with node tests/test_player_subtitle_appearance.js (requires Playwright and Chromium).
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
      window.savedPrefs = {subSize: 100, subPosition: 6};
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
        media: { prefs: () => savedPrefs, setPrefs: values => Object.assign(savedPrefs, values) },
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
    await page.evaluate(() => {
      const track = document.getElementById('mp-video').addTextTrack('subtitles');
      track.mode = 'showing';
      track.addCue(new VTTCue(0, 10, 'Caption'));
    });
    await page.click('#mp-subs');
    const adjust = (id, delta) => page.locator('[data-control-id="' + id + '"]').evaluate((el, delta) => {
      el.dispatchEvent(new CustomEvent('framed:adjust', {detail: {delta, fast: false}}));
    }, delta);
    await adjust('size', 1);
    assert.equal(await page.evaluate(() => savedPrefs.subSize), 105);
    assert.equal(await page.locator('#mp-video').evaluate(el => el.style.getPropertyValue('--cue-size')), '105%');
    assert.equal(await page.locator('#mp-subtitles').evaluate(el => el.style.fontSize), '29.4px');
    await adjust('position', 1);
    assert.equal(await page.evaluate(() => savedPrefs.subPosition), 7);
    assert.equal(await page.locator('#mp-subtitles').evaluate(el => el.style.bottom), '22%', 'controls keep captions above the band');
    await adjust('position', 23);
    assert.equal(await page.evaluate(() => savedPrefs.subPosition), 30);
    assert.equal(await page.locator('#mp-subtitles').evaluate(el => el.style.bottom), '30%');
    assert.deepEqual(await page.evaluate(() => {
      const cue = document.getElementById('mp-video').textTracks[0].cues[0];
      return [cue.line, cue.snapToLines, cue.lineAlign];
    }), [70, false, 'end']);
    await adjust('position', 100);
    assert.equal(await page.evaluate(() => savedPrefs.subPosition), 80);
    await adjust('position', -100);
    assert.equal(await page.evaluate(() => savedPrefs.subPosition), 0);
    await adjust('size', 100);
    assert.equal(await page.evaluate(() => savedPrefs.subSize), 300);
    await adjust('size', -100);
    assert.equal(await page.evaluate(() => savedPrefs.subSize), 25);
    await page.addStyleTag({ path: path.join(root, 'css/theme.css') });
    await page.addStyleTag({ path: path.join(root, 'css/app.css') });
    await page.evaluate(() => {
      const line = document.createElement('span');
      line.className = 'player__sub-line';
      line.textContent = 'Caption on a black letterbox';
      document.getElementById('mp-subtitles').appendChild(line);
    });
    const background = () => page.locator('.player__sub-line').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(await background(), 'rgba(0, 0, 0, 0)', 'old preferences default to no background');
    for (const [delta, value, css, color] of [
      [1, 'black', '#000000', 'rgb(0, 0, 0)'],
      [1, 'tinted', 'var(--fr-cue-ground)', 'rgba(18, 25, 28, 0.72)'],
      [-1, 'black', '#000000', 'rgb(0, 0, 0)'],
      [-1, 'off', 'transparent', 'rgba(0, 0, 0, 0)']
    ]) {
      await adjust('background', delta);
      assert.equal(await page.evaluate(() => savedPrefs.subBackground), value);
      assert.equal(await background(), color, 'AVPlay overlay updates immediately');
      assert.equal(await page.locator('#mp-video').evaluate(el => el.style.getPropertyValue('--cue-background')), css,
        'HTML5 cues receive the same background');
    }
    assert.deepEqual(errors, []);
    console.log('Subtitle appearance checks passed: granular sizing, position, cue alignment, control clearance, bounds and saved background choices.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
