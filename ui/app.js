import { createWidgets } from './widgets.js';
import { renderAnswerView } from './answer-renderer.js';
import { startLoading } from './loading.js';
import { renderAssignmentWorkspace } from './assignment-workspace.js';

const $ = id => document.getElementById(id);
const refreshWidgets = createWidgets(async (course, title) => {
  try { await load(); } catch (error) { notice(error.message); return; }
  showAssignment(null);
  $('course').value = course;
  $('prompt').value = title;
  search(!title);
});
let status;
let courses = [];
let request;
let aiRequest;
let assignmentContext;
let taskContext;
let defaultModel = '';
let finishPromptLoading = () => {};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, signal) {
  const response = await fetch(path, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not read the local inventory.');
  return data;
}

async function aiAction(action, body = {}, signal) {
  const response = await fetch(`/api/llm/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'AI request failed.');
  return data;
}

async function loadAI() {
  const finish = startLoading($('model-loading'), 'Loading models');
  try {
    clearAnswer();
    $('model').replaceChildren(new Option('Local search', ''));
    defaultModel = '';
    updateComposer();
    const connection = await api('/api/llm/status');
    if (connection.active) {
      const { models } = await api('/api/llm/models');
      const group = element('optgroup');
      group.label = 'ChatGPT';
      group.append(...models.map(m => new Option(m.name, m.id)));
      $('model').append(group);
      defaultModel = models[0]?.id || '';
      $('model').value = defaultModel;
    }
    updateComposer();
  } finally { finish(); }
}

function updateComposer() {
  const model = $('model').value;
  $('model-sharing').hidden = !model;
  $('adaptive-help').hidden = !!model;
  $('model').setAttribute('aria-describedby', model ? 'model-sharing' : 'adaptive-help');
  $('send').disabled = !$('prompt').value.trim() || !$('busy').hidden;
  $('send').setAttribute('aria-label', model ? `Ask ${$('model').selectedOptions[0].textContent}` : 'Search locally');
}

function setBusy(busy, label = 'Searching…') {
  finishPromptLoading();
  $('busy').hidden = !busy;
  if (busy) finishPromptLoading = startLoading($('busy'), label);
  if (busy) $('search-form').setAttribute('aria-busy', 'true');
  else $('search-form').removeAttribute('aria-busy');
  updateComposer();
}

function clearAnswer() {
  aiRequest?.abort();
  request?.abort();
  aiRequest = request = undefined;
  setBusy(false);
  $('ai-answer').hidden = true;
  $('answer-text').textContent = '';
  $('answer-view').replaceChildren();
  $('answer-view').hidden = true;
  $('ai-answer-title').textContent = 'Your answer';
  $('answer-sources').replaceChildren();
}

async function askAI() {
  if (!$('prompt').value.trim()) { notice('Enter a coursework question first.'); return; }
  if (!$('model').value) return search();
  clearAnswer();
  const current = aiRequest = new AbortController();
  setBusy(true, 'Thinking…');
  $('results').hidden = true;
  notice();
  try {
    const data = await aiAction('answer', { q: $('prompt').value.trim(), course: $('course').value,
      context: taskContext || null, model: $('model').value, consent: true }, current.signal);
    if (aiRequest !== current) return;
    $('workspace').classList.add('has-results');
    if (data.workspace) {
      showAssignment(data.workspace, status?.demo || false);
      if (data.workspace.kind === 'task') taskContext.summary = JSON.stringify({
        question: data.workspace.question,
        sections: data.workspace.sections.map(({ title, purpose }) => ({ title, purpose })),
        answer: data.answer || '', view: data.view || null,
      }).slice(0, 12_000);
      if (data.workspace.question || data.answerWarning) {
        if (data.answerWarning) notice(data.answerWarning);
        $('assignment-heading').focus();
        return;
      }
    }
    $('answer-text').textContent = data.answer;
    const rendered = renderAnswerView($('answer-view'), data.view, data.sources);
    $('answer-view').hidden = !rendered || !data.view.sections.length;
    $('ai-answer-title').textContent = rendered ? data.view.title || data.workspace?.title || 'Your answer' : data.workspace?.title || 'Your answer';
    if (data.viewWarning) notice(data.viewWarning);
    $('answer-sources').replaceChildren();
    $('ai-answer').querySelector('.answer-sources-heading').hidden = data.workspace?.kind === 'task';
    for (const [i, source] of data.sources.entries()) {
      if (data.workspace?.kind === 'task') continue;
      const article = element('article', undefined, 'source');
      article.id = `answer-source-${i + 1}`;
      article.tabIndex = -1;
      article.append(element('h3', `[${i + 1}] ${source.title}`), element('p', source.excerpt),
        element('p', `${source.courseName} · ${source.stale ? 'Stale cache' : 'Cached'} · ${date(source.lastSuccess)}`, 'source-meta'));
      const link = element('a', source.url.includes('/dropbox/') ? 'Open assignment in Brightspace ↗' : 'Open course in Brightspace ↗');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      article.append(link);
      $('answer-sources').append(article);
    }
    $('ai-answer').hidden = false;
    $('ai-answer').querySelector('h2').focus();
  } catch (error) { if (error.name !== 'AbortError' && aiRequest === current) notice(error.message); }
  finally {
    if (aiRequest === current) {
      setBusy(false);
    }
  }
}

function notice(text = '') {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

function date(value) {
  const stamp = new Date(value);
  return value && !Number.isNaN(stamp.valueOf()) ? stamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';
}

async function load() {
  const finish = startLoading($('course-loading'), 'Loading courses');
  try {
    [status, { courses }] = await Promise.all([api('/api/status'), api('/api/courses')]);
    const selected = $('course').value;
    $('course').replaceChildren(new Option('All courses', ''), ...courses.map(course => new Option(course.name, course.id)));
    if (courses.some(course => course.id === selected)) $('course').value = selected;
    $('demo-badge').hidden = !status.demo;
    if (!courses.length) notice('No cached courses yet. If setup or start is running, collection is in progress. Otherwise run npx @ivanbard/dd2l setup (npm run setup from source).');
  } finally { finish(); }
}

function reset() {
  clearAnswer();
  showAssignment(null);
  $('prompt').value = '';
  $('model').value = defaultModel;
  updateComposer();
  $('results').hidden = true;
  $('result-list').replaceChildren();
  $('workspace').classList.remove('has-results');
  $('prompt').focus();
}

function searchParams(query) {
  return new URLSearchParams({ q: query, course: $('course').value, assignment: assignmentContext?.course === $('course').value ? assignmentContext.id : '' });
}

function showAssignment(workspace, demo = false) {
  taskContext = workspace?.kind === 'task' ? workspace.context : workspace?.status === 'resolved'
    ? { goal: `Work on ${workspace.title} in ${workspace.courseName}`, sourceIds: [] } : undefined;
  assignmentContext = workspace?.status === 'resolved' ? { id: workspace.id, course: workspace.course } : undefined;
  if (assignmentContext) $('course').value = assignmentContext.course;
  renderAssignmentWorkspace($('assignment-workspace'), workspace, demo, choice => {
    assignmentContext = { id: choice.id, course: choice.course };
    $('course').value = choice.course;
    if ($('model').value) askAI(); else search();
  });
  if (workspace) $('workspace').classList.add('has-results');
}

async function search(browse = false) {
  clearAnswer();
  const query = $('prompt').value.trim();
  if (!browse && !query) return;
  request?.abort();
  const current = request = new AbortController();
  setBusy(true);
  notice();
  try {
    const data = await api(`/api/search?${searchParams(browse ? '' : query)}`, current.signal);
    if (request !== current) return;
    showAssignment(data.workspace, data.demo);
    if (data.workspace) {
      $('results').hidden = true;
      $('assignment-heading').focus();
      return;
    }
    $('workspace').classList.add('has-results');
    $('results').hidden = false;
    $('results-title').textContent = browse ? 'Course materials' : 'Search results';
    $('result-count').textContent = `${Math.min(30, data.total)} of ${data.total} sources`;
    $('result-list').replaceChildren();
    for (const source of data.results) {
      const article = element('article', undefined, 'source');
      article.append(element('div', `${source.courseName} · ${source.category.replaceAll('_', ' ')}`, 'source-meta'),
        element('h3', source.title), element('p', source.excerpt));
      const meta = element('div', `${source.stale ? 'Stale cache · ' : 'Cached · '}${date(source.lastSuccess)}`, `source-meta${source.stale ? ' stale' : ''}`);
      article.append(meta);
      if (!data.demo) {
        const link = element('a', 'Open course in onQ ↗');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        article.append(link);
      }
      $('result-list').append(article);
    }
    if (!data.total) $('result-list').append(element('p', 'No matching cached sources. Try a course name, topic, or assignment keyword. Only material already retrieved by the connector can appear here.', 'empty'));
    $('results-title').focus();
  } catch (error) {
    if (error.name !== 'AbortError' && request === current) {
      $('results').hidden = true;
      notice(error.message);
    }
  } finally {
    if (request === current) {
      setBusy(false);
    }
  }
}

function openPanel(title) {
  $('panel-title').textContent = title;
  $('panel-body').replaceChildren();
  if (!$('panel').open) $('panel').showModal();
}

async function showCourses() {
  openPanel('Courses');
  const finish = startLoading($('panel-loading'), 'Loading cached courses');
  try {
    await load();
    $('panel-body').replaceChildren(element('p', 'Browse materials already collected from onQ.'));
    for (const course of courses) {
      const button = element('button', course.name, 'course-item');
      button.type = 'button';
      button.append(element('small', course.active ? 'Active course' : 'Historical course'));
      button.addEventListener('click', () => {
        showAssignment(null);
        $('course').value = course.id;
        $('prompt').value = '';
        $('panel').close();
        search(true);
      });
      $('panel-body').append(button);
    }
    if (!courses.length) $('panel-body').append(element('p', 'No cached courses yet. Let setup finish collecting, then reopen Courses. To connect onQ, run npx @ivanbard/dd2l setup (npm run setup from source).'));
  } catch (error) { $('panel-body').replaceChildren(element('p', error.message)); }
  finally { finish(); }
}

async function showStatus() {
  openPanel('Connection status');
  const finish = startLoading($('panel-loading'), 'Loading connection status');
  try {
    await load();
    $('panel-body').replaceChildren(
      element('p', status.demo ? 'Demo mode · fictional sample coursework. No school account is connected to this view.' : 'Local inventory · read-only. Local search stays on this device. Selecting a ChatGPT model and sending a question shares matching coursework with OpenAI.'),
      element('p', `${status.courseCount} courses · ${status.sourceCount} searchable sources`),
      element('p', `Connector: ${status.state?.state || 'Not synced'} · Last successful source: ${date(status.lastSuccess)}`),
      element('p', 'Select a ChatGPT model to build adaptive workspaces around your goals. Local mode uses keyword matching and assignment records. Missing sources and access restrictions mean coverage may be incomplete.'),
      element('p', 'Setup and start collect coursework automatically while the terminal stays open.'),
      element('p', 'If sign-in has expired, stop the app and run npx @ivanbard/dd2l setup (npm run setup from source). For later launches use npx @ivanbard/dd2l start (npm start -- start from source). Reopen Courses or search again to read the latest cache.'),
    );
    const connection = await api('/api/llm/status');
    $('panel-body').append(element('h3', 'Use your ChatGPT plan'));
    if (connection.disabled) { $('panel-body').append(element('p', 'Provider sign-in is disabled in demo mode. Start the live UI to connect ChatGPT.')); return; }
    $('panel-body').append(element('p', 'Eligible answers use your ChatGPT plan and its usage limits. dd2l does not automatically switch to an API key. Select a model and send a question to share matching coursework for that answer.'));
    const action = (label, handler) => {
      const button = element('button', label, 'account-action');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const finishAction = startLoading(button, `${label} in progress`);
        try { await handler(); } catch (error) { $('panel-body').append(element('p', error.message)); }
        finally { finishAction(); button.disabled = false; }
      });
      $('panel-body').append(button);
    };
    for (const account of connection.accounts) {
      $('panel-body').append(element('p', `${account.label}${account.id === connection.active ? ' · Active' : ''}`));
      action(account.connected ? 'Use this account' : 'Continue with ChatGPT', async () => {
        if (account.connected) { clearAnswer(); await aiAction('select', { id: account.id }); await loadAI(); await showStatus(); }
        else location.assign((await aiAction('login', { id: account.id })).url);
      });
      if (account.connected) action('Sign in again to this account', async () => location.assign((await aiAction('login', { id: account.id })).url));
    }
    action('Continue with ChatGPT', async () => location.assign((await aiAction('login')).url));
    if (connection.active) action('Sign out of active ChatGPT account', async () => {
      clearAnswer();
      const result = await aiAction('logout');
      await loadAI();
      await showStatus();
      $('panel-body').append(element('p', result.message));
    });
    const usage = element('a', 'Manage usage in ChatGPT');
    usage.href = 'https://chatgpt.com/settings/usage'; usage.target = '_blank'; usage.rel = 'noopener noreferrer';
    $('panel-body').append(usage);
  } catch (error) { $('panel-body').replaceChildren(element('p', error.message)); }
  finally { finish(); }
}

$('prompt').addEventListener('input', clearAnswer);
$('model').addEventListener('change', () => { clearAnswer(); notice(); });
$('search-form').addEventListener('submit', event => { event.preventDefault(); if ($('model').value) askAI(); else search(); });
$('course').addEventListener('change', () => { const browsing = !$('results').hidden || !$('assignment-workspace').hidden || !$('busy').hidden; clearAnswer(); showAssignment(null); if (browsing && !$('model').value) search(!$('prompt').value.trim()); });
$('new-chat').addEventListener('click', reset);
$('search-nav').addEventListener('click', () => $('prompt').focus());
$('courses-nav').addEventListener('click', showCourses);
$('settings-nav').addEventListener('click', showStatus);
$('profile').addEventListener('click', showStatus);
$('refresh-widgets').addEventListener('click', refreshWidgets);
$('close-panel').addEventListener('click', () => $('panel').close());
$('panel').addEventListener('click', event => { if (event.target === $('panel')) {
  const rect = $('panel').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('panel').close();
} });
load().then(refreshWidgets).catch(error => notice(error.message));
loadAI().catch(error => notice(error.message));
