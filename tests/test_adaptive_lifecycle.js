// Run with node tests/test_adaptive_lifecycle.js (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium'
  });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.setContent('<div id="art-stage"></div><div id="adaptive-color-matrix"></div><div id="art-ambient-status"></div>');
    await page.evaluate(() => {
      window.testSettings = { brightness: 100, adaptiveBrightness: 'on', adaptiveTone: 'on', adaptiveDefaulted: true };
      window.screenName = 'launcher';
      window.framed = { store: { get: () => window.testSettings }, router: { current: () => window.screenName } };
      window.sensorLux = 213;
      window.reads = 0;
      window.__tvBridge = { readAmbient: () => {
        window.reads++;
        if (window.holdRead) return new Promise(resolve => { window.resolveRead = resolve; });
        if (window.failRead) return Promise.reject(new Error('Offline'));
        return Promise.resolve({ lux: window.sensorLux, cct_kelvin: 3000, color_reliable: true });
      } };
    });
    for (const file of ['adaptive-core.js', 'adaptive.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../framed/js', file) });
    }
    const output = () => page.evaluate(() => document.getElementById('adaptive-color-matrix').getAttribute('values'));
    const act = method => page.evaluate(method => framed.adaptive[method](), method);
    // The launcher prepares Art without ever entering it.
    await page.clock.runFor(250);
    assert.equal(await page.evaluate(() => framed.adaptive.state().output.brightness),
      await page.evaluate(() => framed.adaptiveCore.target(window.testSettings, framed.adaptive.state().sensor, Date.now()).brightness));
    const initialReads = await page.evaluate(() => window.reads);
    await page.evaluate(() => { window.sensorLux = 586; });
    await page.clock.runFor(3500);
    assert((await page.evaluate(() => window.reads)) > initialReads, 'launcher keeps sampling');
    const prepared = await output();
    const readsBeforeEntry = await page.evaluate(() => window.reads);
    await page.evaluate(() => { window.screenName = 'art'; framed.adaptive.start(); });
    assert.equal(await output(), prepared, 'entry already has the latest ambient target');
    assert.equal(await page.evaluate(() => window.reads), readsBeforeEntry, 'entry reuses the polling loop');
    // Changes while viewing Art still ease toward the new target.
    await page.evaluate(() => { window.sensorLux = 213; });
    await page.clock.runFor(2500);
    assert((await page.evaluate(() => framed.adaptive.state().output.brightness)) >
      (await page.evaluate(() => framed.adaptiveCore.target(window.testSettings, framed.adaptive.state().sensor, Date.now()).brightness)));
    await page.clock.runFor(1100);
    const settled = await output();
    // Retarget mid-fade without jumping, then finish within one second.
    await page.evaluate(() => { framed.adaptive.state().sensor.lux = 586; });
    await page.clock.runFor(250);
    const rising = await page.evaluate(() => framed.adaptive.state().output.brightness);
    assert(rising > Number(settled.split(' ')[0]));
    await page.clock.runFor(16);
    const nextFrame = await page.evaluate(() => framed.adaptive.state().output.brightness);
    assert(nextFrame > rising, 'fractional output advances on consecutive frames');
    await page.evaluate(() => { framed.adaptive.state().sensor.lux = 213; });
    await page.clock.runFor(16);
    const redirected = await page.evaluate(() => framed.adaptive.state().output.brightness);
    assert(Math.abs(redirected - nextFrame) < 0.01, 'retarget starts at the displayed value');
    await page.clock.runFor(1100);
    assert.equal(await output(), settled, 'reversed fade reaches its exact target');
    const reading = await page.evaluate(() => framed.adaptive.state().sensor.receivedAt);
    await act('stop');
    const reads = await page.evaluate(() => window.reads);
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => window.reads), reads, 'no polling while suspended');
    assert.equal(await page.evaluate(() => framed.adaptive.state().sensor.receivedAt), reading);
    await act('start');
    assert.equal(await output(), settled, 'five-second app resume preserves the displayed matrix');
    await page.clock.runFor(1000);
    const resumed = (await output()).split(' ').map(Number);
    const original = settled.split(' ').map(Number);
    assert(resumed.every((value, i) => Math.abs(value - original[i]) < 1e-8), 'unchanged room stays steady');

    // Even after a long absence, entry itself must not snap to the fallback.
    await act('stop');
    const beforeAbsence = await output();
    await page.clock.runFor(60000);
    await page.evaluate(() => { window.failRead = true; });
    await act('start');
    assert.equal(await output(), beforeAbsence);
    await page.clock.runFor(250);
    const fading = await page.evaluate(() => framed.adaptive.state().output);
    assert(fading.brightness < Number(beforeAbsence.split(' ')[0]));
    assert(fading.brightness > 0.167, 'stale readings fade smoothly toward 15%');
    await page.clock.runFor(1100);
    assert(Math.abs((await page.evaluate(() => framed.adaptive.state().output.brightness)) - 0.167) < 1e-8);

    // A completed request from before stop must not replace the retained sample.
    await act('stop');
    await page.evaluate(() => { window.holdRead = true; });
    await act('start');
    await act('stop');
    await page.evaluate(() => window.resolveRead({ lux: 1, cct_kelvin: 6500 }));
    assert.equal(await page.evaluate(() => framed.adaptive.state().sensor.lux), 213);

    // Explicit manual settings still take effect immediately.
    await page.evaluate(() => {
      window.testSettings.adaptiveBrightness = 'off';
      window.testSettings.adaptiveTone = 'off';
      window.testSettings.brightness = 50;
      window.dispatchEvent(new Event('framed:settings'));
    });
    assert.equal(await page.evaluate(() => framed.adaptive.state().output.brightness), 0.51);
    assert.equal(await page.evaluate(() => framed.adaptive.state().output.warm), 0);
    console.log('Adaptive lifecycle: reentry, retained readings, stale fallback, cancelled polls and manual settings passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
