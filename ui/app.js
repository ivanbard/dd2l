const $ = id => document.getElementById(id);
let status;
let courses = [];
let request;

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

function notice(text = '') {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

function date(value) {
  const stamp = new Date(value);
  return value && !Number.isNaN(stamp.valueOf()) ? stamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';
}

async function load() {
  [status, { courses }] = await Promise.all([api('/api/status'), api('/api/courses')]);
  const selected = $('course').value;
  $('course').replaceChildren(new Option('All courses', ''), ...courses.map(course => new Option(course.name, course.id)));
  if (courses.some(course => course.id === selected)) $('course').value = selected;
  $('demo-badge').hidden = !status.demo;
  if (!courses.length) notice('No cached courses yet. Run npm run login, then npm run audit -- --all. Or start with npm run ui -- --demo to explore sample coursework.');
}

function reset() {
  request?.abort();
  $('search-form').removeAttribute('aria-busy');
  $('busy').hidden = true;
  $('prompt').value = '';
  $('send').disabled = true;
  $('results').hidden = true;
  $('result-list').replaceChildren();
  $('workspace').classList.remove('has-results');
  $('prompt').focus();
}

async function search(browse = false) {
  const query = $('prompt').value.trim();
  if (!browse && !query) return;
  request?.abort();
  const current = request = new AbortController();
  $('send').disabled = true;
  $('busy').hidden = false;
  $('search-form').setAttribute('aria-busy', 'true');
  notice();
  try {
    const data = await api(`/api/search?${new URLSearchParams({ q: browse ? '' : query, course: $('course').value })}`, current.signal);
    if (request !== current) return;
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
      $('busy').hidden = true;
      $('search-form').removeAttribute('aria-busy');
      $('send').disabled = !$('prompt').value.trim();
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
  $('panel-body').append(element('p', 'Loading cached courses…'));
  try {
    await load();
    $('panel-body').replaceChildren(element('p', 'Browse materials already collected from onQ.'));
    for (const course of courses) {
      const button = element('button', course.name, 'course-item');
      button.type = 'button';
      button.append(element('small', course.active ? 'Active course' : 'Historical course'));
      button.addEventListener('click', () => {
        $('course').value = course.id;
        $('prompt').value = '';
        $('panel').close();
        search(true);
      });
      $('panel-body').append(button);
    }
    if (!courses.length) $('panel-body').append(element('p', 'No courses in the local inventory. Run npm run audit -- --all after signing in.'));
  } catch (error) { $('panel-body').replaceChildren(element('p', error.message)); }
}

async function showStatus() {
  openPanel('Connection status');
  $('panel-body').append(element('p', 'Reading local inventory…'));
  try {
    await load();
    $('panel-body').replaceChildren(
      element('p', status.demo ? 'Demo mode · fictional sample coursework. No school account is connected to this view.' : 'Local inventory · read-only. Your coursework stays on this computer.'),
      element('p', `${status.courseCount} courses · ${status.sourceCount} searchable sources`),
      element('p', `Connector: ${status.state?.state || 'Not synced'} · Last successful source: ${date(status.lastSuccess)}`),
      element('p', 'Search uses keywords and cached excerpts. AI answers are not connected in this iteration. Missing sources and access restrictions mean coverage may be incomplete.'),
      element('p', 'To refresh coursework, run:'), element('code', 'npm run audit -- --all'),
      element('p', 'If sign-in has expired, run npm run login first. Use npm run sync -- --all for ongoing collection. Reopen Courses or search again to read the latest cache.'),
    );
  } catch (error) { $('panel-body').replaceChildren(element('p', error.message)); }
}

$('prompt').addEventListener('input', () => { $('send').disabled = !$('prompt').value.trim() || !$('busy').hidden; });
$('search-form').addEventListener('submit', event => { event.preventDefault(); search(); });
$('course').addEventListener('change', () => { if (!$('results').hidden || !$('busy').hidden) search(!$('prompt').value.trim()); });
$('new-chat').addEventListener('click', reset);
$('search-nav').addEventListener('click', () => $('prompt').focus());
$('courses-nav').addEventListener('click', showCourses);
$('settings-nav').addEventListener('click', showStatus);
$('profile').addEventListener('click', showStatus);
$('close-panel').addEventListener('click', () => $('panel').close());
$('panel').addEventListener('click', event => { if (event.target === $('panel')) {
  const rect = $('panel').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('panel').close();
} });
load().catch(error => notice(error.message));
