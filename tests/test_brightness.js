// Run with node tests/test_brightness.js (requires Playwright and Chromium).
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
    const registered = [];
    await page.exposeFunction('recordKey', key => registered.push(key));
    await page.addInitScript(() => {
      window.tizen = { tvinputdevice: { registerKey: key => window.recordKey(key) } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/#/launcher`);
    const press = (code, extra = {}) => page.evaluate(({code, extra}) => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({keyCode:code, bubbles:true, cancelable:true}, extra)));
    }, {code, extra});
    const saved = () => page.evaluate(() => framed.store.get('settings', {}).appBrightness);
    const opacity = () => page.locator('#brightness-veil').evaluate(el => Number(getComputedStyle(el).opacity));
    const hud = page.locator('#brightness-hud');
    const focus = await page.evaluate(() => document.activeElement.outerHTML);
    await press(428);
    assert.equal(await saved(), 95);
    assert.equal(await opacity(), 0.05);
    assert.equal(await hud.getAttribute('aria-valuenow'), '95');
    assert.equal(await page.locator('#brightness-value').textContent(), '95%');
    assert.equal(await page.evaluate(() => document.activeElement.outerHTML), focus);
    assert(registered.includes('ChannelUp') && registered.includes('ChannelDown'));
    // Samsung colour keys must not be mistaken for channel keys.
    await press(403); await press(404);
    assert.equal(await saved(), 95);
    for (let i=0; i<25; i++) await press(428);
    assert.equal(await saved(), 5);
    assert.equal(await opacity(), 0.95);
    for (let i=0; i<25; i++) await press(427);
    assert.equal(await saved(), 100);
    await press(428);
    await page.reload();
    assert.equal(await opacity(), 0.05);
    assert.equal(await hud.isVisible(), false);
    // Dimming works while an input has focus, and cannot swallow text input.
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'test-input'; document.body.appendChild(input); input.focus();
    });
    await press(0, {key:'ChannelDown'});
    assert.equal(await saved(), 90);
    // Repeat events are throttled, while separate presses are not.
    await page.evaluate(() => {
      for(let i=0;i<20;i++) document.dispatchEvent(new KeyboardEvent('keydown', {keyCode:428, repeat:true, bubbles:true}));
    });
    assert.equal(await saved(), 90);
    await page.waitForTimeout(120);
    await press(428, {repeat:true});
    assert.equal(await saved(), 85);
    await page.evaluate(() => document.getElementById('test-input').remove());
    await page.waitForTimeout(1500);
    await press(428);
    await page.waitForTimeout(700);
    assert.equal(await hud.isVisible(), true);
    await hud.waitFor({state:'hidden', timeout:2500});
    // Art never inherits the app veil or loses its adaptive/manual settings.
    const artBefore = await page.evaluate(() => {
      const s = framed.store.get('settings', {}); return [s.brightness, s.adaptiveBrightness, s.adaptiveTone];
    });
    await page.evaluate(() => framed.router.go('art'));
    await page.waitForFunction(() => framed.router.current() === 'art');
    assert.equal(await opacity(), 0);
    await press(428);
    assert.equal(await saved(), 80);
    assert.deepEqual(await page.evaluate(() => {
      const s = framed.store.get('settings', {}); return [s.brightness, s.adaptiveBrightness, s.adaptiveTone];
    }), artBefore);
    await page.evaluate(() => framed.router.go('settings'));
    await page.waitForFunction(() => framed.router.current() === 'settings');
    assert.equal(await opacity(), 0.2);
    await page.locator('#toast').waitFor({state:'hidden'});
    await press(427);
    await page.setViewportSize({width:1920,height:1080});
    await page.screenshot({path:'/workspace/scratch/brightness-slider.png'});
    // Malformed persisted data safely falls back to full brightness.
    await page.evaluate(() => framed.store.merge('settings', {appBrightness:'bad'}, {}));
    await page.reload();
    assert.equal(await opacity(), 0);
    assert.deepEqual(errors, []);
    console.log('Brightness: keys, bounds, persistence, repeat, timeout, focus and Art isolation passed.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
