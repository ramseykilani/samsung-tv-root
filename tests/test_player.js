// Run with: node tests/test_player.js (Playwright + Chromium required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const base = path.join(__dirname, '../framed');
    await page.setContent(fs.readFileSync(path.join(base, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
    await page.evaluate(() => {
      window.calls = [];
      window.webapis = {avplay: {
        stop() {}, close() {}, open() {}, setDisplayRect() {}, setListener(l) {window.listener = l;},
        prepareAsync(cb) {window.prepared = cb;}, play() {}, pause() {},
        getDuration() {return 7200000;}, getTotalTrackInfo() {return [];},
        getCurrentStreamInfo() {return [];},
        seekTo(ms, ok, fail) {calls.push({ms, ok, fail});}
      }};
      window.tizen = {};
      window.framed = {router: {register(name, screen) {window.screenPlayer = screen;}}, nav: {focus(el) {el.focus();}, setScope(el, opts) {if (opts.initial) opts.initial.focus();}, isBackKey() {return false;}}, media: {prefs() {return {subSize: 100};}, setPrefs() {}}};
    });
    await page.addScriptTag({path: path.join(base, 'js/engine.js')});
    await page.evaluate(() => {
      const attach = framed.engine.attach;
      framed.engine.attach = video => (window.engine = attach(video));
    });
    await page.addScriptTag({path: path.join(base, 'js/controls.js')});
    await page.addScriptTag({path: path.join(base, 'js/screens/media-play.js')});
    await page.evaluate(() => {engine.open('test.mp4'); engine.play(); prepared();});
    await page.evaluate(() => {
      document.getElementById('screen-media-play').hidden = false;
      document.getElementById('mp-timeline').focus();
    });
    const downFromTimeline = () => page.evaluate(() => {
      document.getElementById('mp-timeline').focus();
      const handled = screenPlayer.onKey({keyCode: 40});
      return {handled, id: document.activeElement.id};
    });
    assert.deepEqual(await downFromTimeline(), {handled: true, id: 'mp-options'}, 'default to Options');
    await page.locator('#mp-subs').focus();
    assert.deepEqual(await downFromTimeline(), {handled: true, id: 'mp-subs'}, 'return to the last action');
    await page.locator('#mp-speed').focus();
    assert.deepEqual(await downFromTimeline(), {handled: true, id: 'mp-speed'}, 'update the remembered action');
    await page.evaluate(() => {document.getElementById('mp-speed').disabled = true;});
    assert.deepEqual(await downFromTimeline(), {handled: true, id: 'mp-options'}, 'fall back when the last action is unavailable');
    await page.evaluate(() => {document.getElementById('mp-speed').disabled = false;});
    assert.equal(await page.evaluate(() => engine.paused()), false, 'async startup must update pause flag');
    assert.equal(await page.locator('#mp-state').textContent(), 'Playing');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--fr-chrome-linger', '80');
      document.getElementById('mp-subs').click();
      document.querySelector('[data-control-id="size"]').dispatchEvent(new CustomEvent('framed:adjust', {detail: {delta: 1, fast: false}}));
      document.getElementById('mp-video').dispatchEvent(new Event('pause'));
    });
    assert.equal(await page.locator('#mp-state').textContent(), 'Playing', 'stray pause while editing subtitles must not override AVPlay');
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#mp').getAttribute('data-chrome'), 'shown', 'subtitle menu keeps controls visible');
    await page.evaluate(() => screenPlayer.back());
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#mp').getAttribute('data-chrome'), 'hidden', 'closing subtitles restores auto-hide without toggling playback');
    await page.evaluate(() => {
      engine.pause();
      document.getElementById('mp-video').dispatchEvent(new Event('playing'));
    });
    assert.equal(await page.locator('#mp-state').textContent(), 'Paused', 'stray playing event must not override a real pause');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#mp').getAttribute('data-chrome'), 'shown', 'real pause keeps controls visible');
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--fr-chrome-linger');
      engine.play();
    });
    await page.evaluate(() => document.getElementById('mp-timeline').dispatchEvent(new CustomEvent('framed:adjust', {detail: {delta: 1, fast: false}})));
    assert.equal(await page.locator('#mp-preview').evaluate(el => el.style.width), '', 'preview must keep thumb width');
    assert.ok(parseFloat(await page.locator('#mp-preview').evaluate(el => el.style.left)) > 0);
    await page.evaluate(() => screenPlayer.onKey({keyCode: 13}));
    await page.evaluate(() => {engine.seek(3600); listener.oncurrentplaytime(1000);});
    assert.equal(await page.evaluate(() => calls.length), 1, 'seeks must serialize');
    assert.equal(await page.evaluate(() => engine.time()), 3600, 'pending target survives stale time updates');
    await page.evaluate(() => calls[0].ok());
    assert.equal(await page.evaluate(() => calls[1].ms), 3600000);
    await page.evaluate(() => {engine.pause(); listener.onbufferingcomplete();});
    assert.equal(await page.locator('#mp').getAttribute('data-state'), 'paused');
    await page.evaluate(() => calls[1].ok());
    assert.equal(await page.locator('#mp-now').textContent(), '1:00:00');
    assert.equal(await page.locator('#mp-state').textContent(), 'Paused');
    await page.evaluate(() => {engine.play(); listener.onbufferingstart();});
    await page.waitForTimeout(5200);
    assert.equal(await page.locator('#mp').getAttribute('data-chrome'), 'shown', 'buffering must cancel chrome timer');
    await page.evaluate(() => listener.onbufferingcomplete());
    assert.equal(await page.locator('#mp-state').textContent(), 'Playing');
    assert.equal(await page.locator('#mp-state').textContent(), 'Playing');
    await page.evaluate(() => {engine.seek(4000); calls[2].fail();});
    assert.equal(await page.evaluate(() => engine.time()), 3600, 'failed seek restores confirmed position');
    await page.evaluate(() => {engine.seek(4100); engine.close(); calls[3].ok();});
    assert.equal(await page.evaluate(() => engine.time()), 0, 'closed stream ignores late seek completion');
    console.log('Player regression checks passed: scrub geometry, async startup, queued seeks, buffering, pause/resume, failure and close.');
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
