import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createUiServer } from '../src/ui-server.mjs';
import { fixtures } from '../experiments/design-systems/fixtures.mjs';
import { buildTaskWorkspace, taskCatalogue } from '../src/task-workspace.mjs';
import { demoInventory } from '../src/ui-demo.mjs';

const server = createUiServer({ demo: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  page = await context.newPage();
  const errors = [], external = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) external.push(request.url()); });
  await context.route('**/api/llm/status', route => route.fulfill({ json: { active: 'model', accounts: [] } }));
  await context.route('**/api/llm/models', route => route.fulfill({ json: { models: [{ id: 'model', name: 'Test model' }] } }));
  let scope = (await (await fetch(`${origin}/api/status`)).json()).scope;
  const ids = fixtures.sources.filter(source => source.courseName.includes('ELEC')).map(source => source.id);
  const catalogue = taskCatalogue(demoInventory());
  const task = buildTaskWorkspace({ title: 'Filter design', goal: fixtures.scenarios.planner.goal, question: '',
    sections: [{ title: 'Requirements and rubric', purpose: 'Finish the report', sourceIds: ids }] }, catalogue, catalogue.length, catalogue.length);
  let program = { ...structuredClone(fixtures.scenarios.planner), answer: 'Check the requirements and begin a draft beside them.', layout: 'columns' };
  let release, started;
  await context.route('**/api/llm/answer', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 2) { started(); await new Promise(resolve => { release = resolve; }); }
    await route.fulfill({ json: { ...task, components: program, answer: program.answer, scope } });
  });
  await page.goto(origin);
  await page.locator('#model option[value="model"]').waitFor({ state: 'attached' });
  const send = async text => { await page.locator('#prompt').fill(text); await page.locator('#prompt').press('Enter'); await page.locator('.generated-components[data-ready="true"]').waitFor(); };
  await send('Help me finish the filter report');
  const frame = () => page.frameLocator('.generated-components');
  await frame().getByRole('textbox', { name: 'Assignment draft' }).fill('My report outline: introduce the design and explain the calculations.');
  await frame().getByRole('textbox', { name: 'Draft notes' }).fill('Check phase plot labels.');
  await frame().getByRole('checkbox').first().check();
  await frame().getByRole('status').filter({ hasText: 'Saved in this browser' }).waitFor();
  const draftBox = await frame().getByRole('textbox', { name: 'Assignment draft' }).boundingBox();
  const requirementsBox = await frame().getByRole('heading', { name: 'Requirements', exact: true }).boundingBox();
  assert.ok(draftBox.x > requirementsBox.x + 100);
  const dimensions = await frame().locator('#root').evaluate(root => ({ width: innerWidth, root: root.getBoundingClientRect().width,
    children: [...root.children].map(node => ({ tag: node.tagName, width: node.getBoundingClientRect().width, className: node.className })),
    heading: root.querySelector('h1').getBoundingClientRect().width, draft: root.querySelector('.draft-editor').getBoundingClientRect().width }));
  assert.ok(dimensions.heading > 700 && dimensions.draft > 350, JSON.stringify(dimensions));
  await page.setViewportSize({ width: 1400, height: 1700 });
  await page.evaluate(() => scrollTo(0, 0));
  await frame().locator('html').evaluate(() => scrollTo(0, 0));
  await mkdir('.dd2l', { recursive: true });
  await page.screenshot({ path: '.dd2l/ui-components-columns.png', fullPage: true });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await frame().getByRole('button', { name: /Read source:/ }).first().click();
  await page.locator('#canvas-source').waitFor();
  assert.match(await page.locator('#canvas-source a').getAttribute('href'), /dropbox/);
  const began = new Promise(resolve => { started = resolve; });
  program = { ...program, title: 'Report workspace with tabs', layout: 'tabs', sections: program.sections.filter(section => section.type !== 'notes') };
  const followup = send('Use tabs and keep my draft and notes');
  await began;
  await frame().getByRole('textbox', { name: 'Assignment draft' }).pressSequentially(' Updated while generating.');
  release(); await followup;
  await page.locator('#canvas-title').getByText('Report workspace with tabs', { exact: true }).waitFor();
  await frame().getByRole('heading', { name: 'Report workspace with tabs' }).waitFor();
  assert.match(await frame().getByRole('textbox', { name: 'Assignment draft' }).inputValue(), /Updated while generating/);
  await frame().getByRole('button', { name: 'Notes from earlier layouts' }).click();
  await frame().getByText('Check phase plot labels.', { exact: true }).waitFor();
  assert.match(requests[1].components.state.draft, /My report outline/);
  assert.equal(requests[1].canvas, null);
  await frame().getByRole('status').filter({ hasText: 'Saved in this browser' }).waitFor();
  const record = await page.evaluate(async scope => {
    const { createWorkspaceStore } = await import('/workspace-storage.js');
    return (await createWorkspaceStore(scope).list())[0];
  }, scope);
  assert.match(record.state.draft, /Updated while generating/);
  await page.reload();
  await page.locator('#saved-work').waitFor();
  await page.locator('#saved-work-list').getByRole('button', { name: program.title, exact: true }).click();
  await page.locator('.generated-components[data-ready="true"]').waitFor();
  assert.equal(await frame().getByRole('textbox', { name: 'Assignment draft' }).inputValue(), record.state.draft);
  assert.equal(await frame().getByRole('checkbox').first().isChecked(), true);
  await page.getByRole('button', { name: 'Restart progress' }).click();
  await frame().locator('input[name="calculations"]:not(:checked)').waitFor({ state: 'attached' });
  await page.locator('.generated-components[data-ready="true"]').waitFor();
  assert.equal(await frame().getByRole('checkbox').first().isChecked(), false);
  assert.equal(await frame().getByRole('textbox', { name: 'Assignment draft' }).inputValue(), record.state.draft);
  await frame().getByRole('status').filter({ hasText: 'Saved in this browser' }).waitFor();
  // A stale writer cannot replace work from another tab or storage transaction.
  const conflict = await page.evaluate(async record => {
    const { createWorkspaceStore } = await import('/workspace-storage.js');
    try { await createWorkspaceStore(record.scope).save(record, 0); return false; } catch { return true; }
  }, record);
  assert.equal(conflict, true);
  const otherScope = await page.evaluate(async () => {
    const { createWorkspaceStore } = await import('/workspace-storage.js');
    return createWorkspaceStore('b'.repeat(64)).list();
  });
  assert.deepEqual(otherScope, []);
  const concurrent = await page.evaluate(async record => {
    const { createWorkspaceStore } = await import('/workspace-storage.js');
    const scope = 'c'.repeat(64), first = createWorkspaceStore(scope), second = createWorkspaceStore(scope);
    const next = { ...record, id: crypto.randomUUID(), scope, revision: 0 };
    const results = await Promise.allSettled([first.save(next, 0), second.save(next, 0)]);
    return results.map(result => result.status).sort();
  }, record);
  assert.deepEqual(concurrent, ['fulfilled', 'rejected']);
  await page.route('**/api/workspace-sources?**', route => route.fulfill({ status: 404, json: { error: 'Access revoked. Export your draft from Saved work.' } }));
  await page.getByRole('button', { name: 'New search', exact: true }).click();
  await page.locator('#saved-work-list').getByRole('button', { name: program.title, exact: true }).click();
  await page.getByText('Access revoked. Export your draft from Saved work.', { exact: true }).waitFor();
  assert.equal(await page.locator('.generated-components').count(), 0);
  await page.unroute('**/api/workspace-sources?**');
  await page.locator('#saved-work-list').getByRole('button', { name: program.title, exact: true }).click();
  await page.locator('.generated-components[data-ready="true"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await frame().locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  assert.ok(await page.locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  const download = page.waitForEvent('download');
  await frame().getByRole('button', { name: 'Export draft', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'dd2l-draft.txt');
  await mkdir('.dd2l', { recursive: true });
  await page.setViewportSize({ width: 390, height: 2400 });
  await frame().locator('html').evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '.dd2l/ui-components-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1400, height: 1700 });
  await frame().locator('html').evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '.dd2l/ui-components-desktop.png', fullPage: true });
  await frame().getByRole('status').filter({ hasText: 'Saved in this browser' }).waitFor();
  await page.evaluate(scope => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record) {
      if (record.scope === scope) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, record);
    };
  }, scope);
  await frame().getByRole('textbox', { name: 'Assignment draft' }).fill('Unsaved text must remain exportable after leaving the workspace.');
  await frame().getByRole('status').filter({ hasText: 'Not saved.' }).waitFor();
  await page.getByRole('button', { name: 'New search', exact: true }).click();
  const recovery = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export unsaved draft', exact: true }).click();
  assert.match(await readFile(await (await recovery).path(), 'utf8'), /Unsaved text must remain exportable/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Discard unsaved copy', exact: true }).click();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Mantine workspace checks passed: draft autosave/reopen/export, generation follow-ups, notes retention, sources, access revocation, account isolation, concurrency and mobile.');
} catch (error) {
  if (page) console.error(await page.locator('#notice').textContent().catch(() => 'Page unavailable'));
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
