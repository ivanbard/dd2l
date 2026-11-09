import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createUiServer } from '../src/ui-server.mjs';
import { demoInventory } from '../src/ui-demo.mjs';
import { taskCatalogue, buildTaskWorkspace } from '../src/task-workspace.mjs';

const server = createUiServer({ demo: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let networkHits = 0;
const sink = createServer((req, res) => { networkHits++; res.end('Should not be reached'); });
await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve));
const sinkUrl = `http://127.0.0.1:${sink.address().port}/private`;
let browser;
let page;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    globalThis.canvasClicks = [];
    document.addEventListener('click', event => {
      canvasClicks.push({ target: event.target.outerHTML?.slice(0, 200), x: event.clientX, y: event.clientY });
    }, true);
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/llm/status', route => route.fulfill({ json: { active: 'test', accounts: [] } }));
  await page.route('**/api/llm/models', route => route.fulfill({ json: { models: [{ id: 'model', name: 'Canvas test model' }] } }));
  const all = taskCatalogue(demoInventory());
  const sources = all.filter(source => source.course === '103' && ['instructions', 'rubric'].includes(source.category));
  const task = buildTaskWorkspace({ title: 'Work on filter design', goal: 'Complete the filter report', question: '',
    sections: [{ title: 'Requirements', purpose: 'Check the report against the rubric', sourceIds: sources.map(source => source.id) }] }, all, all.length, all.length);
  const sourceId = task.sources[0].id;
  let program = { title: 'Filter design desk', answer: 'Work through the report using the assignment and rubric.',
    html: `<h1>Finish your filter report</h1><label><input type="checkbox" name="calculations"> Calculations checked</label><label>Draft notes<textarea name="notes"></textarea></label><button data-source="${sourceId}">Read requirements</button>`,
    css: 'main{max-width:900px;margin:auto}h1{font-size:clamp(28px,4vw,48px)}label{display:block;margin:24px 0}textarea{display:block;width:100%;min-height:100px}button{padding:12px}',
    js: 'return {state};' };
  const requests = [];
  let markFollowup, releaseFollowup;
  const followupStarted = new Promise(resolve => { markFollowup = resolve; });
  const followupRelease = new Promise(resolve => { releaseFollowup = resolve; });
  await page.route('**/api/llm/answer', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 2) { markFollowup(); await followupRelease; }
    await route.fulfill({ json: { ...task, canvas: program, answer: program.answer } });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.locator('#model option[value="model"]').waitFor({ state: 'attached' });
  const send = async query => {
    await page.locator('#prompt').fill(query);
    await page.locator('#prompt').press('Enter');
    await page.locator('#busy').waitFor({ state: 'hidden' });
    await page.locator('#canvas-workspace').waitFor({ state: 'visible' });
    if (program.title !== 'Timeout check') await page.locator('.generated-canvas[data-ready="true"]').waitFor();
  };
  await send('Help me finish the filter report');
  const canvas = () => page.frameLocator('.generated-canvas');
  await canvas().getByRole('heading', { name: 'Finish your filter report' }).waitFor();
  assert.equal(await page.locator('.generated-canvas').getAttribute('sandbox'), 'allow-scripts');
  await canvas().getByRole('checkbox').check();
  await canvas().getByRole('textbox').fill('Check the phase plot labels.');
  await canvas().getByRole('button', { name: 'Read requirements' }).click();
  await page.locator('#canvas-source').waitFor({ state: 'visible' });
  assert.match(await page.locator('#canvas-source').textContent(), /Submit a PDF/);
  assert.ok((await page.locator('#canvas-source a').getAttribute('href')).includes('/dropbox/'));
  program = { ...program, title: 'Report and rubric', html: `${program.html}<aside><h2>Rubric alongside your draft</h2><p>Validate the frequency response plots.</p></aside>`,
    css: `${program.css}main{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:24px}@media(max-width:600px){main{display:block}}` };
  const following = send('Put the rubric beside my checklist and keep my notes');
  await followupStarted;
  await canvas().getByRole('textbox').fill('These notes changed while the model was working.');
  releaseFollowup();
  await following;
  await canvas().getByRole('heading', { name: 'Rubric alongside your draft' }).waitFor();
  assert.equal(requests[1].canvas.state.inputs.calculations.checked, true);
  assert.equal(requests[1].canvas.state.inputs.notes.value, 'Check the phase plot labels.');
  assert.equal(await canvas().getByRole('checkbox').isChecked(), true);
  assert.equal(await canvas().getByRole('textbox').inputValue(), 'These notes changed while the model was working.');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '.dd2l/ui-canvas-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.dd2l/ui-canvas-mobile.png', fullPage: true });

  await page.locator('#new-chat').click();
  assert.equal(await page.locator('#canvas-workspace').isVisible(), false);
  program = { title: 'Memory practice', answer: 'Practice retrieval.', html: '<h1>Memory practice</h1><p>What distinguishes working memory?</p><button data-action="reveal">Reveal explanation</button><div id="explanation"></div>',
    css: 'button{padding:12px}', js: 'if(event.action === "reveal") state.revealed=true; return {state,html:`<h1>Memory practice</h1><p>What distinguishes working memory?</p><button data-action="reveal">Reveal explanation</button><div id="explanation">${state.revealed ? "Working memory holds and manipulates information." : ""}</div>`};' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await page.locator('#new-chat').click();
    await send('Prepare me for the memory seminar with practice questions');
    assert.equal(requests.at(-1).canvas, null);
    assert.equal(await canvas().locator('#explanation').textContent(), '');
    await canvas().getByRole('button', { name: 'Reveal explanation' }).click();
    await canvas().getByText('Working memory holds and manipulates information.', { exact: true }).waitFor();
  }

  program = { title: 'Afternoon planner', answer: 'Allocate your available study time.', html: '<h1>Plan your afternoon</h1><label>Minutes available<input name="minutes" type="range" min="30" max="240" value="180"></label><p>Adjust the slider to change your plan.</p>', css: 'label{display:block}input{width:100%}',
    js: 'const minutes=Number(state.inputs?.minutes?.value || 180); return {state,html:`<h1>Plan your afternoon</h1><label>Minutes available<input name="minutes" type="range" min="30" max="240" value="${minutes}"></label><p>${Math.round(minutes/2)} minutes for each priority</p>`};' };
  await send('I have three hours; help me plan across my courses');
  await canvas().getByRole('heading', { name: 'Plan your afternoon' }).waitFor();
  await canvas().getByRole('slider').fill('120');
  await canvas().getByText('60 minutes for each priority', { exact: true }).waitFor();

  program = { title: 'Choice controls', answer: 'Choose an answer.', html: '<h1>Choose a class</h1><label><input name="class" type="radio" value="one"> Class one</label><label><input name="class" type="radio" value="two"> Class two</label><button data-action="refresh">Refresh view</button>', css: '', js: 'return {state:{view:"practice"}};' };
  await send('Test a practice question with radio choices');
  await canvas().getByRole('radio', { name: 'Class one' }).check();
  await canvas().getByRole('button', { name: 'Refresh view' }).click();
  assert.equal(await canvas().getByRole('radio', { name: 'Class one' }).isChecked(), true);
  assert.equal(await canvas().getByRole('radio', { name: 'Class two' }).isChecked(), false);

  program = { title: 'Isolation check', answer: 'Test fixture.',
    html: `<h1>Isolation check</h1><script>parent.document.body.textContent='escaped'</script><meta http-equiv="refresh" content="0;url=${sinkUrl}"><iframe src="${sinkUrl}"></iframe><img src="${sinkUrl}"><a href="${sinkUrl}" onclick="location.href='${sinkUrl}'">Untrusted link</a><form action="${sinkUrl}"><button>Submit</button></form><button data-source="invalid">Forged source</button>`,
    css: `body{background-image:url('${sinkUrl}')}`,
    js: `if(typeof document !== 'undefined' || typeof parent !== 'undefined') throw Error('Browser access leaked'); fetch('${sinkUrl}').catch(()=>{}); try{importScripts('${sinkUrl}')}catch{}; try{self.location.href='${sinkUrl}'}catch{}; return {state};` };
  await send('Run the isolation fixture');
  await canvas().getByRole('heading', { name: 'Isolation check' }).waitFor();
  assert.equal(await canvas().locator('#canvas script,#canvas meta,#canvas iframe,#canvas img,#canvas [onclick],#canvas [href],#canvas form[action]').count(), 0);
  await canvas().getByText('Untrusted link', { exact: true }).click();
  await canvas().getByRole('button', { name: 'Submit', exact: true }).click();
  await canvas().getByRole('button', { name: 'Forged source' }).click();
  assert.equal(networkHits, 0);
  assert.equal(page.url(), origin + '/');
  program = { ...program, title: 'Timeout check', html: '<h1>Timeout check</h1>', css: '', js: 'while(true){}' };
  await send('Run the timeout fixture');
  await page.getByText('The generated workspace took too long to respond. Your last saved progress is retained.', { exact: true }).waitFor();
  assert.equal(await page.locator('#send').isEnabled(), true);
  await page.locator('#new-chat').click();
  assert.deepEqual(errors, []);
  console.log('Canvas checks passed: assignment, practice, planner, state preservation, verified sources, mobile, markup/worker isolation and timeout recovery.');
} catch (error) {
  for (const frame of page?.frames() || []) {
    console.error('Canvas failure diagnostics:', await frame.evaluate(() => ({
      url: location.pathname, clicks: globalThis.canvasClicks,
      html: document.getElementById('canvas')?.innerHTML,
      notice: document.getElementById('notice')?.textContent,
    })).catch(() => 'Frame unavailable'));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => sink.close(resolve));
}
