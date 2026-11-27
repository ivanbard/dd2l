import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createComparisonServer } from './server.mjs';

const output = fileURLToPath(new URL('../../.dd2l/', import.meta.url));
await mkdir(output, { recursive: true });
const server = createComparisonServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const until = async (read, expected) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const actual = await read();
    if (actual === expected) return;
    await delay(30);
  }
  assert.equal(await read(), expected);
};
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, reducedMotion: 'reduce', acceptDownloads: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [], remote = [], violations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') console.error(event.text()); });
  page.on('request', request => { if (!request.url().startsWith(origin)) remote.push(request.url()); });
  await page.exposeFunction('reportViolation', detail => violations.push(detail));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => reportViolation(`${event.violatedDirective}: ${event.blockedURI}`)));
  await page.goto(origin);
  await page.getByText('Both renderers ready.', { exact: false }).waitFor();
  const daisy = page.frameLocator('#daisy'), mantine = page.frameLocator('#mantine');
  for (const frame of [daisy, mantine]) {
    await frame.getByRole('heading', { name: 'Finish the filter design report' }).waitFor();
    assert.equal(await frame.getByRole('checkbox').count(), 3);
  }
  assert.equal(await page.locator('#daisy').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.locator('#mantine').getAttribute('sandbox'), 'allow-scripts');
  await daisy.getByRole('checkbox').first().check();
  await mantine.locator('input[name="calculations"]:checked').waitFor({ state: 'attached' });
  await mantine.getByRole('checkbox').nth(1).check();
  await daisy.getByText('2 of 3 requirements complete', { exact: true }).waitFor();
  await daisy.getByRole('button', { name: 'Read source' }).first().click();
  await page.locator('#source-title').waitFor();
  assert.match(await page.locator('#source-text').textContent(), /Points: 40/);
  await page.getByRole('button', { name: 'Close source' }).click();
  // Arrow navigation exercises the native tabs; Mantine supplies its own tab behavior.
  await daisy.getByRole('tab', { name: 'Requirements' }).focus();
  await daisy.getByRole('tab', { name: 'Requirements' }).press('End');
  await daisy.getByRole('textbox', { name: 'Draft notes' }).fill('Check the phase plot labels.');
  await until(() => mantine.getByRole('textbox', { name: 'Draft notes' }).inputValue(), 'Check the phase plot labels.');
  await page.getByRole('button', { name: 'Move notes first' }).click();
  assert.equal(await daisy.getByRole('tab').first().textContent(), 'Draft notes');
  assert.equal(await mantine.getByRole('textbox', { name: 'Draft notes' }).inputValue(), 'Check the phase plot labels.');
  await mantine.getByRole('textbox', { name: 'Draft notes' }).fill('Retained from Mantine.');
  await until(() => daisy.getByRole('textbox', { name: 'Draft notes' }).inputValue(), 'Retained from Mantine.');
  await mantine.getByRole('textbox', { name: 'Draft notes' }).pressSequentially(' Rapid updates keep every keystroke.');
  await until(() => daisy.getByRole('textbox', { name: 'Draft notes' }).inputValue(), 'Retained from Mantine. Rapid updates keep every keystroke.');
  await daisy.getByRole('tab', { name: 'Work date' }).click();
  await daisy.getByLabel('Planned work date').fill('2026-11-12');
  await until(() => mantine.getByRole('button', { name: 'Planned work date' }).textContent(), '2026-11-12');
  await mantine.getByRole('button', { name: 'Planned work date' }).click();
  await mantine.getByRole('button', { name: /13 November 2026/ }).click();
  await until(() => daisy.getByLabel('Planned work date').inputValue(), '2026-11-13');
  await daisy.getByRole('tab', { name: 'Requirements' }).click();
  await page.screenshot({ path: `${output}/compare-desktop.png`, fullPage: true });
  await page.getByText('Try a generated or adapted plan', { exact: true }).click();
  const original = JSON.parse(await page.locator('#plan').inputValue());
  const adapted = { ...original, title: 'Adapted report workspace', sections: [...original.sections].reverse() };
  await page.locator('#plan').fill(JSON.stringify(adapted));
  await page.getByRole('button', { name: 'Apply plan to both' }).click();
  await mantine.getByRole('heading', { name: 'Adapted report workspace' }).waitFor();
  assert.equal(await daisy.getByRole('checkbox').first().isChecked(), true);
  const markup = '<img src="https://example.invalid/tracker" onerror="alert(1)">';
  await page.locator('#plan').fill(JSON.stringify({ ...adapted, title: markup }));
  await page.getByRole('button', { name: 'Apply plan to both' }).click();
  for (const frame of [daisy, mantine]) {
    await frame.getByRole('heading', { name: markup, exact: true }).waitFor();
    assert.equal(await frame.locator('#root img,#root script,#root iframe').count(), 0);
  }
  await page.locator('#plan').fill(JSON.stringify(adapted));
  await page.getByRole('button', { name: 'Apply plan to both' }).click();
  // Reject executable fields and retain the current plan.
  await page.locator('#plan').fill(JSON.stringify({ ...adapted, html: '<script>bad()</script>' }));
  await page.getByRole('button', { name: 'Apply plan to both' }).click();
  await page.getByText('Plan rejected.', { exact: false }).waitFor();
  assert.equal(await mantine.getByRole('heading', { name: 'Adapted report workspace' }).count(), 1);
  await page.locator('#scenario').selectOption('study');
  await daisy.getByRole('radio').first().check();
  await mantine.locator('input[name="retrieval"]:checked').waitFor({ state: 'attached' });
  await mantine.getByRole('button', { name: 'Check answer' }).first().click();
  await daisy.getByRole('status').filter({ hasText: 'Correct.' }).waitFor();
  await mantine.getByRole('radio').nth(1).check();
  await daisy.getByRole('status').filter({ hasText: 'Correct.' }).waitFor({ state: 'hidden' });
  await daisy.getByRole('button', { name: 'Check answer' }).first().click();
  await mantine.getByRole('status').filter({ hasText: 'Try again.' }).waitFor();
  await page.getByRole('button', { name: 'Reset progress' }).click();
  await until(() => mantine.getByRole('button', { name: 'Check answer' }).first().isDisabled(), true);
  await page.locator('#width').selectOption('280');
  for (const frame of [daisy, mantine]) assert.ok(await frame.locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  for (const id of ['daisy', 'mantine']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.frameLocator(`#${id}`).getByRole('heading', { name: 'Practice memory and retrieval' }).waitFor();
    await page.locator(`#panel-${id}`).screenshot({ path: `${output}/compare-mobile-${id}.png` });
  }
  await page.getByText('Record the comparison', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Observations' }).fill('Automated parity check.');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export comparison JSON' }).click();
  const artifact = await download;
  const report = JSON.parse(await readFile(await artifact.path(), 'utf8'));
  assert.equal(report.observations, 'Automated parity check.');
  assert.equal(report.plan.title, 'Practice memory and retrieval');
  assert.ok(report.firstPaintMs.daisy > 0 && report.firstPaintMs.mantine > 0);
  assert.ok(report.measurements.renderers.daisy.gzip > 0);
  await page.locator('#view').selectOption('daisy');
  assert.equal(await page.locator('#panel-mantine').isVisible(), false);
  await page.locator('#view').selectOption('mantine');
  assert.equal(await page.locator('#panel-daisy').isVisible(), false);
  await page.locator('#view').selectOption('both');
  assert.equal(await page.locator('#panel-daisy').isVisible(), true);
  assert.deepEqual(remote, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  console.log('Comparison browser checks passed: state parity, adaptation, sources, dates, practice, validation, mobile layouts, isolation and export.');
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${output}/compare-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.close(); server.closeAllConnections();
}
