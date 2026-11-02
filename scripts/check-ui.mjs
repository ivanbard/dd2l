import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createUiServer } from '../src/ui-server.mjs';

const server = createUiServer({ demo: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 832 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#demo-badge').waitFor({ state: 'visible' });
  const assets = await page.locator('img').evaluateAll(images => images.map(img => ({ loaded: img.complete && img.naturalWidth > 0,
    width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })));
  assert.equal(assets.length, 7);
  assert.ok(assets.every(asset => asset.loaded && asset.width > 0 && asset.height > 0));
  const navIcons = await page.locator('.icon-button img').evaluateAll(images => images.map(img => ({
    src: img.getAttribute('src'), width: img.width, height: img.height,
  })));
  assert.equal(navIcons.length, 4);
  assert.ok(navIcons.every(icon => icon.src.endsWith('.svg') && icon.width === 16 && icon.height === 16));
  const composer = await page.locator('.composer').boundingBox();
  assert.equal(composer.x, 360);
  assert.equal(composer.y, 316);
  assert.equal(composer.width, 560);
  assert.equal(composer.height, 128);
  assert.equal(await page.locator('#send').isDisabled(), true);
  await mkdir('.dd2l', { recursive: true });
  await page.screenshot({ path: '.dd2l/ui-home.png' });
  await page.locator('#prompt').fill('recursion');
  await page.locator('#prompt').press('Enter');
  await page.locator('.source').waitFor();
  assert.match(await page.locator('#result-list').textContent(), /Assignment 3/);
  assert.equal(await page.locator('.source a').count(), 0);
  await page.locator('#course').selectOption('102');
  await page.locator('.empty').waitFor();
  await page.locator('#courses-nav').click();
  await page.locator('.course-item').last().click();
  await page.locator('.source').first().waitFor();
  assert.match(await page.locator('#result-list').textContent(), /Memory/);
  assert.doesNotMatch(await page.locator('#result-list').textContent(), /Recursion/);
  await page.screenshot({ path: '.dd2l/ui-results.png' });
  await page.locator('#settings-nav').click();
  await page.getByText('Demo mode · fictional sample coursework.', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#panel').isVisible(), false);
  await page.locator('#new-chat').click();
  assert.equal(await page.locator('#results').isVisible(), false);
  assert.equal(await page.locator('#prompt').inputValue(), '');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.dd2l/ui-mobile.png' });
  await page.route('**/api/search?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Inventory unavailable. Try again.' }) }));
  await page.locator('#prompt').fill('memory');
  await page.locator('#prompt').press('Enter');
  await page.getByText('Inventory unavailable. Try again.', { exact: true }).waitFor();
  assert.equal(await page.locator('#send').isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('UI smoke passed: design geometry, local assets, search, filtering, course browsing, status, reset, mobile layout and recoverable errors.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
