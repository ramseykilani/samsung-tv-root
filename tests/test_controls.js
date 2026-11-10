// Run with node tests/test_controls.js (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="controls"></div>');
    for (const file of ['nav.js', 'controls.js']) {
      await page.addScriptTag({ path: path.join(__dirname, '../framed/js', file) });
    }
    await page.evaluate(() => {
      window.changes = [];
      window.controls = framed.controls.render(document.getElementById('controls'), [
        { id: 'sound', name: 'Sound', type: 'choice', value: 'en', options: [
          { value: 'en', label: 'English' }, { value: 'fr', label: 'French' }
        ] },
        { id: 'color', name: 'Colour', type: 'swatch', value: 'red', options: [
          { value: 'red', label: 'Red', color: 'red' }, { value: 'blue', label: 'Blue', color: 'blue' }
        ] },
        { id: 'size', name: 'Size', type: 'range', value: 1, min: 0, max: 2 },
        { id: 'action', name: 'Action', type: 'action' },
        { id: 'retry', name: 'Retry', type: 'action', fault: true },
        { id: 'gated', name: 'Unavailable', type: 'action', gated: true }
      ], (id, value, spec, meta) => changes.push({ id, value, meta }));
      framed.nav.init();
      framed.nav.setScope(document.getElementById('controls'));
    });
    for (const [id, initial, next] of [['sound', 'en', 'fr'], ['color', 'red', 'blue'], ['size', 1, 2]]) {
      const row = page.locator('[data-control-id="' + id + '"]');
      await row.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(id => controls.get(id), id), initial);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(id => controls.get(id), id), next);
      const count = await page.evaluate(() => changes.length);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(id => controls.get(id), id), next, 'OK must not wrap at the last value');
      assert.equal(await page.evaluate(() => changes.length), count, 'OK must not reapply a saved value');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(id => controls.get(id), id), initial);
    }
    await page.locator('[data-control-id="sound"] [data-value="fr"]').click();
    assert.equal(await page.evaluate(() => controls.get('sound')), 'fr');
    for (const id of ['action', 'retry', 'gated']) {
      await page.locator('[data-control-id="' + id + '"]').focus();
      await page.keyboard.press('Enter');
    }
    assert.deepEqual(await page.evaluate(() => changes.slice(-3)), [
      { id: 'action', value: true, meta: undefined },
      { id: 'retry', value: true, meta: { retry: true } },
      { id: 'gated', value: undefined, meta: { rejected: true } }
    ]);
    console.log('Shared controls: OK confirms choices, swatches and ranges; arrows, pointer selection, actions, retry and gating passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
