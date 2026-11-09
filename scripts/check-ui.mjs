import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createUiServer } from '../src/ui-server.mjs';

const server = createUiServer({ demo: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let callbackServer;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 832 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
  const initial = gate(), home = gate(), waits = new Map([
    ['/api/status', initial], ['/api/courses', initial], ['/api/llm/status', initial], ['/api/home', home],
  ]);
  await page.route('**/api/**', async route => {
    await waits.get(new URL(route.request().url()).pathname)?.promise;
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#course-loading .dot-loader').waitFor();
  await page.locator('#model-loading .dot-loader').waitFor();
  assert.equal(await page.locator('#course-loading .dot-loader > span').count(), 25);
  assert.equal(await page.locator('#model-loading .dot-loader').getAttribute('role'), 'status');
  assert.equal(await page.locator('#model-loading .dot-loader > span').first().evaluate(dot => getComputedStyle(dot).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const dotStyles = await page.locator('#model-loading .dot-loader > span').evaluateAll(dots => dots.map(dot => ({ name: getComputedStyle(dot).animationName, delay: getComputedStyle(dot).animationDelay })));
  assert.ok(dotStyles.every(dot => dot.name === 'dot-origin-wave'));
  assert.equal(dotStyles[6].delay, '0s');
  assert.equal(dotStyles[24].delay, '1.44s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  waits.delete('/api/status'); waits.delete('/api/courses'); waits.delete('/api/llm/status');
  initial.release();
  await page.locator('#widget-loading .dot-loader').waitFor();
  assert.equal(await page.locator('#widget-loading .dot-loader > span').count(), 25);
  waits.delete('/api/home'); home.release();
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
  assert.ok(composer.x > 60);
  assert.ok(composer.y < 200);
  assert.equal(composer.width, 560);
  assert.equal(composer.height, 128);
  assert.equal(await page.locator('#send').isDisabled(), true);
  await mkdir('.dd2l', { recursive: true });
  await page.locator('#widget-deadlines').waitFor();
  const loaderLifetime = await page.evaluate(async () => {
    const { startLoading } = await import('/loading.js');
    const target = document.createElement('span'); target.setAttribute('aria-busy', 'false'); document.body.append(target);
    const first = startLoading(target, 'First operation'), second = startLoading(target, 'Second operation');
    const counts = [target.querySelectorAll('.dot-loader').length];
    first(); first(); counts.push(target.querySelectorAll('.dot-loader').length);
    second(); counts.push(target.querySelectorAll('.dot-loader').length);
    const busy = target.getAttribute('aria-busy'); target.remove();
    return { counts, busy };
  });
  assert.deepEqual(loaderLifetime, { counts: [1, 1, 0], busy: 'false' });
  assert.equal(await page.locator('.widget').count(), 3);
  assert.match(await page.locator('#widget-deadlines').textContent(), /Assignment 3/);
  assert.match(await page.locator('#widget-announcements').textContent(), /Midterm review/);
  await page.screenshot({ path: '.dd2l/ui-home.png' });
  // The core assignment workspace works locally, including ambiguity and follow-ups.
  await page.locator('#prompt').fill('I am going to work on assignment 2');
  await page.locator('#prompt').press('Enter');
  await page.getByRole('heading', { name: 'Which assignment?', exact: true }).waitFor();
  assert.equal(await page.locator('#assignment-workspace .course-item').count(), 2);
  await page.locator('#assignment-workspace .course-item').filter({ hasText: 'ELEC 425' }).click();
  await page.getByRole('heading', { name: 'Assignment 2 · Filter design', exact: true }).waitFor();
  assert.equal(await page.locator('#course').inputValue(), '103');
  assert.equal(await page.locator('#results').isVisible(), false);
  assert.match(await page.locator('.assignment-overview').textContent(), /No submissions in the cached response/);
  assert.match(await page.locator('[data-category="rubric"]').textContent(), /Validation/);
  assert.match(await page.locator('[data-category="attachment"]').textContent(), /1 kHz/);
  assert.match(await page.locator('[data-category="feedback"]').textContent(), /Not retrieved/);
  assert.doesNotMatch(await page.locator('#assignment-workspace').textContent(), /Memory journal/);
  await page.screenshot({ path: '.dd2l/ui-assignment-desktop.png', fullPage: true });
  await page.locator('#prompt').fill('Am I ready to submit?');
  await page.locator('#prompt').press('Enter');
  await page.getByText('SUBMISSION CHECK', { exact: true }).waitFor();
  assert.equal(await page.locator('.assignment-card').first().getAttribute('data-category'), 'rubric');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.dd2l/ui-assignment-mobile.png', fullPage: true });
  await page.locator('#prompt').fill('Explain criterion three');
  await page.locator('#prompt').press('Enter');
  await page.getByText('YOUR ASSIGNMENT', { exact: true }).waitFor();
  assert.equal(await page.locator('.assignment-card').first().getAttribute('data-category'), 'rubric');
  await page.locator('#prompt').fill('assignment 99');
  await page.locator('#prompt').press('Enter');
  await page.getByRole('heading', { name: 'Assignment not found', exact: true }).waitFor();
  await page.locator('#new-chat').click();
  assert.equal(await page.locator('#assignment-workspace').isVisible(), false);
  await page.locator('#course').selectOption('');
  await page.setViewportSize({ width: 1280, height: 832 });
  await page.locator('#customize-widgets').click();
  assert.equal(await page.locator('.widget-tools select').count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Move Upcoming deadlines/ }).count(), 0);
  const cellWidth = ((await page.locator('#widget-grid').boundingBox()).width + 16) / 4;
  const deadlineBefore = await page.locator('#widget-deadlines').boundingBox();
  const south = await page.locator('#widget-deadlines .resize-s').boundingBox();
  await page.mouse.move(south.x + south.width / 2, south.y + south.height / 2);
  await page.mouse.down();
  await page.mouse.move(south.x + south.width / 2, south.y + south.height / 2 + 176);
  assert.equal(await page.locator('.widget-preview.blocked').count(), 1);
  await page.mouse.up();
  assert.equal((await page.locator('#widget-deadlines').boundingBox()).height, deadlineBefore.height);
  const east = await page.locator('#widget-deadlines .resize-e').boundingBox();
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(east.x + east.width / 2 - cellWidth, east.y + east.height / 2, { steps: 5 });
  assert.ok((await page.locator('#widget-deadlines').boundingBox()).width < deadlineBefore.width - 100);
  await page.mouse.up();
  await page.locator('#widget-deadlines.size-1x1').waitFor();
  await page.locator('#widget-deadlines').focus();
  await page.keyboard.press('ArrowRight');
  await page.reload();
  await page.locator('#widget-deadlines.size-1x1.col-1').waitFor();
  await page.locator('#customize-widgets').click();
  await page.locator('#widget-announcements').getByRole('button', { name: 'Remove', exact: true }).click();
  assert.equal(await page.locator('.widget').count(), 2);
  await page.locator('#add-widget').click();
  await page.locator('#panel-body').getByRole('button', { name: 'Class announcements' }).click();
  assert.equal(await page.locator('.widget').count(), 3);
  await page.locator('#customize-widgets').click();
  await page.locator('.pin-shortcut').click();
  await page.locator('#panel-body').getByRole('button', { name: /Assignment 3/ }).click();
  assert.match(await page.locator('#widget-shortcuts').textContent(), /Assignment 3/);
  await page.locator('#customize-widgets').click();
  const handle = page.locator('#widget-deadlines .widget-drag');
  const grip = await handle.boundingBox();
  const beforeDrag = await page.locator('#widget-deadlines').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - cellWidth, grip.y + grip.height / 2 + 3 * 176, { steps: 5 });
  const duringDrag = await page.locator('#widget-deadlines').boundingBox();
  assert.ok(Math.abs(duringDrag.x - (beforeDrag.x - cellWidth)) < 1);
  assert.ok(Math.abs(duringDrag.y - (beforeDrag.y + 3 * 176)) < 1);
  assert.equal(await page.locator('.widget-preview:not(.blocked)').count(), 1);
  await page.screenshot({ path: '.dd2l/ui-widget-drag.png' });
  await page.mouse.up();
  await page.locator('#widget-deadlines.row-3').waitFor();
  const corner = await page.locator('#widget-deadlines .resize-se').boundingBox();
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x + 8 + cellWidth, corner.y + 8 + 176);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('#widget-deadlines.size-1x1.row-3').waitFor();
  assert.equal(await page.locator('.widget-preview').count(), 0);
  assert.equal(await page.locator('.widget.dragging').count(), 0);
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x + 8 + cellWidth, corner.y + 8 + 176);
  await page.mouse.up();
  await page.locator('#widget-deadlines.size-2x2.row-3').waitFor();
  await page.locator('#customize-widgets').click();
  await page.reload();
  await page.locator('#widget-deadlines.row-3').waitFor();
  await page.locator('#widget-deadlines.size-2x2').waitFor();
  await page.locator('#widget-shortcuts .shortcut-link').filter({ hasText: 'Assignment 3' }).click();
  await page.getByRole('heading', { name: 'Assignment 3 · Recursion', exact: true }).waitFor();
  assert.match(await page.locator('#assignment-workspace').textContent(), /Implement and test recursive functions/);
  await page.locator('#new-chat').click();
  await page.screenshot({ path: '.dd2l/ui-customized.png' });
  const searching = gate(); waits.set('/api/search', searching);
  await page.locator('#prompt').fill('recursion');
  await page.locator('#prompt').press('Enter');
  await page.locator('#busy .dot-loader').waitFor();
  assert.equal(await page.locator('#busy .dot-loader > span').count(), 25);
  assert.equal(await page.locator('#search-form').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#send img').isVisible(), false);
  await page.screenshot({ path: '.dd2l/ui-dot-loading.png' });
  waits.delete('/api/search'); searching.release();
  await page.locator('.source').waitFor();
  assert.equal(await page.locator('#busy .dot-loader').count(), 0);
  assert.match(await page.locator('#result-list').textContent(), /Assignment 3/);
  assert.equal(await page.locator('.source a').count(), 0);
  await page.locator('#course').selectOption('102');
  await page.locator('.empty').waitFor();
  const panelRead = gate(); waits.set('/api/courses', panelRead);
  await page.locator('#courses-nav').click();
  await page.locator('#panel-loading .dot-loader').waitFor();
  waits.delete('/api/courses'); panelRead.release();
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
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}`);
  await touchPage.locator('#widget-deadlines').waitFor();
  await touchPage.locator('#customize-widgets').click();
  assert.ok(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await touchPage.locator('#widget-deadlines .resize-w').scrollIntoViewIfNeeded();
  const touchEdge = await touchPage.locator('#widget-deadlines .resize-w').boundingBox();
  const touchCell = ((await touchPage.locator('#widget-grid').boundingBox()).width + 16) / 4;
  const touchClient = await touchPage.context().newCDPSession(touchPage);
  const touch = (type, x, y) => touchClient.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tx = touchEdge.x + touchEdge.width / 2, ty = touchEdge.y + touchEdge.height / 2;
  await touch('touchStart', tx, ty);
  await touch('touchMove', tx + touchCell, ty);
  assert.equal(await touchPage.locator('.widget.dragging').count(), 1);
  await touch('touchEnd');
  await touchPage.locator('#widget-deadlines.size-1x1.col-1').waitFor();
  await touchPage.close();
  await page.route('**/api/search?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Inventory unavailable. Try again.' }) }));
  await page.locator('#prompt').fill('memory');
  await page.locator('#prompt').press('Enter');
  await page.getByText('Inventory unavailable. Try again.', { exact: true }).waitFor();
  assert.equal(await page.locator('#send').isEnabled(), true);
  assert.equal(await page.locator('#busy .dot-loader').count(), 0);
  await page.unroute('**/api/search?**');
  // Mock only the provider boundary; exercise mode selection and explicit submission.
  await page.route('**/api/llm/status', route => route.fulfill({ json: { active: 'account', accounts: [{ id: 'account', label: 'Student · workspace', connected: true }] } }));
  await page.route('**/api/llm/models', route => route.fulfill({ json: { models: [{ id: 'model', name: 'Available model' }] } }));
  let aiCalls = 0;
  let answerText = '<script>untrusted</script> Recursion [1].';
  let generatedView = { title: 'Your recursion workspace', answer: 'Use the cached assignment and lecture to plan your work [1].', sections: [
    { type: 'checklist', title: 'Suggested study steps', items: [
      { text: 'Review the recursion lecture before starting.', citations: [1] },
      { text: 'Implement and test your recursive functions.', citations: [1] },
    ] },
    { type: 'cards', title: 'Keep within reach', cards: [
      { title: 'Assignment 3 · Recursion', text: 'Submit a Python file and a short explanation. <img src=x onerror=alert(1)>', citations: [1] },
    ] },
    { type: 'comparison', title: 'Submission requirements', columns: ['Deliverable', 'What to include'], rows: [
      { cells: ['Python file', 'Implemented and tested recursive functions'], citations: [1] },
      { cells: ['Explanation', 'A short explanation submitted through onQ'], citations: [1] },
    ] },
  ] };
  await page.route('**/api/llm/answer', async route => {
    aiCalls++;
    const body = route.request().postDataJSON();
    assert.equal(body.consent, true);
    assert.equal(body.model, 'model');
    await route.fulfill({ json: { answer: answerText, view: generatedView, sources: [{ title: 'Assignment 3 · Recursion', courseName: 'CISC 121 · Introduction to Computing', excerpt: 'Implement and test recursive functions. Submit a Python file and a short explanation through onQ.', lastSuccess: '2026-11-02T14:00:00.000Z', stale: true, url: 'https://onq.queensu.ca/d2l/home/101' }] } });
  });
  await page.reload();
  await page.locator('#model option[value="model"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#model').inputValue(), 'model');
  assert.equal(await page.locator('#model-sharing').isVisible(), true);
  assert.equal(aiCalls, 0);
  await page.locator('#model').selectOption('');
  assert.equal(await page.locator('#model-sharing').isVisible(), false);
  assert.equal(await page.locator('#ai-controls, #ask-ai, #ai-consent').count(), 0);
  await page.locator('#prompt').fill('recursion');
  await page.locator('#prompt').press('Enter');
  await page.locator('#result-list .source').first().waitFor();
  assert.equal(aiCalls, 0);
  await page.locator('#model').selectOption('model');
  assert.equal(aiCalls, 0);
  assert.equal(await page.locator('#model-sharing').isVisible(), true);
  await page.screenshot({ path: '.dd2l/ui-model-mobile.png' });
  await page.locator('#send').click();
  await page.locator('#ai-answer').waitFor({ state: 'visible' });
  assert.equal(aiCalls, 1);
  assert.equal(await page.locator('#answer-text script').count(), 0);
  assert.match(await page.locator('#answer-text').textContent(), /<script>/);
  assert.match(await page.locator('#answer-sources').textContent(), /\[1\].*Assignment/);
  assert.equal(await page.locator('#send').isEnabled(), true);
  assert.equal(await page.locator('.generated-card').count(), 3);
  assert.equal(await page.locator('#answer-view script, #answer-view img').count(), 0);
  await page.locator('.answer-checklist input').first().check();
  assert.match(await page.locator('.answer-progress').textContent(), /1 of 2 complete/);
  assert.equal(await page.locator('.answer-checklist .completed').count(), 1);
  assert.equal(await page.locator('.answer-table-scroll thead th').count(), 3);
  assert.match(await page.locator('.answer-source-cards').textContent(), /<img/);
  assert.match(await page.locator('.answer-references').first().textContent(), /Stale cache/);
  await page.locator('.answer-references a').first().click();
  assert.match(page.url(), /#answer-source-1$/);
  answerText = generatedView.answer;
  generatedView.sections[1].cards[0].text = 'Submit a Python file and a short explanation through onQ.';
  await page.locator('#send').click();
  await page.getByText(answerText, { exact: true }).waitFor();
  assert.match(await page.locator('.answer-progress').textContent(), /0 of 2 complete/);
  await page.locator('#ai-answer-title').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.dd2l/ui-generated-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 832 });
  await page.screenshot({ path: '.dd2l/ui-generated-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  generatedView = { title: 'Invalid layout', answer: 'Text fallback.', sections: [
    { type: 'checklist', title: 'Invalid evidence', items: [{ text: 'Unsupported claim', citations: [99] }] },
  ] };
  await page.locator('#prompt').fill('another question');
  await page.locator('#send').click();
  await page.locator('#ai-answer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#answer-view').isVisible(), false);
  assert.equal(await page.locator('#answer-text').textContent(), answerText);
  await page.locator('#prompt').fill('memory');
  assert.equal(await page.locator('#ai-answer').isVisible(), false);
  let releaseAnswer, markStarted, markFinished;
  const started = new Promise(resolve => { markStarted = resolve; });
  const finished = new Promise(resolve => { markFinished = resolve; });
  await page.route('**/api/llm/answer', async route => {
    aiCalls++;
    markStarted();
    await new Promise(resolve => { releaseAnswer = resolve; });
    try { await route.fulfill({ json: { answer: 'Late answer must stay hidden.', sources: [] } }); }
    catch { /* The browser may already have canceled this request. */ }
    markFinished();
  });
  await page.locator('#prompt').press('Enter');
  await started;
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.equal(await page.locator('#busy .dot-loader > span').count(), 25);
  await page.locator('#model').selectOption('');
  assert.equal(await page.locator('#busy .dot-loader').count(), 0);
  assert.equal(await page.locator('#send').isEnabled(), true);
  releaseAnswer();
  await finished;
  assert.equal(await page.locator('#ai-answer').isVisible(), false);
  await page.locator('#prompt').press('Enter');
  await page.locator('#result-list .source').first().waitFor();
  assert.equal(aiCalls, 4);
  assert.equal(await page.locator('#model-sharing').isVisible(), false);
  await page.locator('#new-chat').click();
  await page.screenshot({ path: '.dd2l/ui-local-search-mobile.png' });
  let workspaceCalls = 0;
  const taskSource = { id: 'memory-source', title: 'Memory and retrieval', category: 'content', courseName: 'PSYC 100',
    text: 'Encoding, working memory, and retrieval practice.', excerpt: 'Encoding, working memory, and retrieval practice.',
    stale: true, status: 'stale', lastSuccess: '2026-11-02T14:00:00Z', url: 'https://onq.queensu.ca/d2l/home/102' };
  const goal = 'Prepare for the memory seminar';
  const adaptiveWorkspace = { kind: 'task', title: 'Your seminar workspace', goal, question: '',
    context: { goal, sourceIds: ['memory-source'] }, catalogueCount: 20, total: 20,
    research: [{ action: 'browse', section: 'content', outcome: 'available' },
      { action: 'read', section: 'resource', outcome: 'needs_login', message: 'School sign-in is required; using cached sources.' }],
    sections: [{ title: 'Understand the ideas', purpose: 'Build confidence before the seminar.', sources: [taskSource] }] };
  await page.route('**/api/llm/answer', async route => {
    workspaceCalls++;
    const body = route.request().postDataJSON();
    assert.equal(body.course, '');
    assert.equal(body.assignment, undefined);
    if (workspaceCalls === 1) {
      assert.equal(body.context, null);
      await route.fulfill({ json: { workspace: { ...adaptiveWorkspace, question: 'Which class would you like to focus on?', sections: [],
        context: { goal: 'Get ready for class', sourceIds: [] } }, sources: [] } });
    } else if (workspaceCalls === 2) {
      assert.equal(body.context.goal, 'Get ready for class');
      await route.fulfill({ json: { workspace: adaptiveWorkspace, answer: 'Practice retrieving the memory concepts before the seminar [1].', sources: [taskSource] } });
    } else {
      assert.equal(body.context.goal, adaptiveWorkspace.context.goal);
      assert.deepEqual(body.context.sourceIds, adaptiveWorkspace.context.sourceIds);
      assert.match(body.context.summary, /Practice retrieving/);
      await route.fulfill({ status: 503, json: { error: 'Provider unavailable. Your workspace is still available locally.' } });
    }
  });
  await page.locator('#course').selectOption('');
  await page.locator('#model').selectOption('model');
  await page.locator('#prompt').fill('Help me feel ready for class');
  await page.locator('#prompt').press('Enter');
  await page.getByText('Which class would you like to focus on?', { exact: true }).waitFor();
  assert.equal(workspaceCalls, 1);
  assert.equal(await page.locator('#ai-answer').isVisible(), false);
  await page.locator('#prompt').fill('The psychology seminar on remembering things');
  await page.locator('#prompt').press('Enter');
  await page.getByText('Practice retrieving the memory concepts before the seminar [1].', { exact: true }).waitFor();
  assert.equal(workspaceCalls, 2);
  assert.match(await page.locator('#assignment-workspace').textContent(), /Understand the ideas/);
  assert.match(await page.locator('#assignment-workspace').textContent(), /Stale cache/);
  assert.match(await page.locator('.research-status').textContent(), /2 connector operations/);
  assert.match(await page.locator('.research-status').textContent(), /resource: needs_login/);
  assert.match(await page.locator('#notice').textContent(), /School sign-in is required/);
  assert.equal(await page.locator('#assignment-workspace').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.dd2l/ui-adaptive-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 832 });
  await page.screenshot({ path: '.dd2l/ui-adaptive-desktop.png', fullPage: true });
  await page.locator('#prompt').fill('Now make this into a study plan');
  await page.locator('#prompt').press('Enter');
  await page.getByText('Provider unavailable. Your workspace is still available locally.', { exact: true }).waitFor();
  assert.equal(workspaceCalls, 3);
  assert.equal(await page.locator('#assignment-workspace').isVisible(), true);
  assert.equal(await page.locator('#ai-answer').isVisible(), false);
  await page.locator('#new-chat').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#settings-nav').click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign out of active ChatGPT account' }).waitFor();
  const accountChange = gate();
  await page.route('**/api/llm/select', async route => { await accountChange.promise; await route.fulfill({ json: {} }); });
  await page.getByRole('button', { name: 'Use this account', exact: true }).click();
  await page.locator('.account-action .dot-loader').waitFor();
  assert.equal(await page.locator('.account-action .dot-loader > span').count(), 25);
  accountChange.release();
  await page.getByRole('button', { name: 'Use this account', exact: true }).waitFor();
  await page.locator('#panel-loading .dot-loader').waitFor({ state: 'hidden' });
  callbackServer = createUiServer({ llm: { callback: async params => {
    if (params.get('state') === 'failed') throw new Error('Sign-in failed');
    return { first: params.get('state') === 'first' };
  } } });
  await new Promise(resolve => callbackServer.listen(0, '127.0.0.1', resolve));
  const callbackOrigin = `http://127.0.0.1:${callbackServer.address().port}`;
  for (const [state, heading] of [['first', "You're using your ChatGPT plan"], ['returning', 'ChatGPT connected'], ['failed', 'Sign-in did not complete']]) {
    await page.goto(`${callbackOrigin}/auth/callback?state=${state}`);
    assert.equal(await page.locator('h1').textContent(), heading);
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('html').evaluate(html => getComputedStyle(html).backgroundColor), 'rgb(34, 34, 34)');
    assert.ok(await page.locator('.auth-brand img').evaluate(img => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.auth-return').evaluate(link => link === document.activeElement), true);
    if (state === 'first') {
      await page.screenshot({ path: '.dd2l/ui-auth-mobile.png' });
      await page.setViewportSize({ width: 1280, height: 832 });
      await page.screenshot({ path: '.dd2l/ui-auth.png' });
    }
  }
  await page.locator('.auth-return').click();
  await page.locator('#workspace').waitFor();
  assert.deepEqual(errors, []);
  console.log('UI smoke passed: assignment workspaces, ambiguity, follow-ups, responsive layouts, loading/cancel cleanup, widgets, generated answers and citations.');
} finally {
  await browser?.close();
  if (callbackServer) await new Promise(resolve => callbackServer.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
