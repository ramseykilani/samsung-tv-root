// Run with node tests/test_art_controls.js (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../framed');
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium'});
    const page = await browser.newPage();
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#/art`);
    await page.keyboard.press('s');
    const row = id => page.locator(`#art-panel [data-control-id="${id}"]`);
    await row('style').waitFor({state:'visible'});
    assert.equal(await row('artFloor').count(), 0);
    assert.equal(await row('brightness').isVisible(), false);
    // Every visible value row must survive repeated remote OK without changing.
    for (const control of await page.locator('#art-panel .control:not([hidden]):not(.control--action)').all()) {
      const before = await control.textContent();
      await control.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      assert.equal(await control.textContent(), before);
    }
    await row('adaptiveBrightness').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await row('brightness').isVisible(), true);
    await row('brightness').focus();
    await page.keyboard.press('ArrowLeft');
    const manual = await page.evaluate(() => framed.store.get('settings', {}).brightness);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => framed.store.get('settings', {}).brightness), manual);
    await row('adaptiveBrightness').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await row('brightness').isVisible(), false);
    assert.equal(await row('artFloor').count(), 0);
    // Explicit pointer choice and action buttons continue to work.
    await row('style').locator('[data-value="none"]').click();
    assert.equal(await page.evaluate(() => framed.store.get('art', {}).style), 'none');
    await page.mouse.move(0, 0);
    await row('reset').focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await page.evaluate(() => framed.store.get('art', {}).style), 'none');
    assert.deepEqual(errors, []);
    console.log('Art controls: OK preserves values, arrows adjust, manual visibility, pointer choice and Reset passed.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
