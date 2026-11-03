const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const date = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not retrieved';
const labels = { missing: 'Not retrieved', inaccessible: 'Inaccessible', not_configured: 'Not configured', stale: 'Stale cache', available: 'Cached' };

function sourceLink(source, demo, label = 'Open assignment in Brightspace ↗') {
  if (demo) return element('small', 'Demo · sample coursework', 'source-meta');
  const link = element('a', label);
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function renderAssignmentWorkspace(target, workspace, demo, choose) {
  target.replaceChildren();
  target.hidden = !workspace;
  if (!workspace) return;
  if (workspace.kind === 'task') { renderTask(target, workspace, demo); return; }
  const heading = element('h2', workspace.status === 'resolved' ? workspace.title : workspace.status === 'choose' ? 'Which assignment?' : 'Assignment not found');
  heading.id = 'assignment-heading';
  heading.tabIndex = -1;
  target.append(heading);
  if (workspace.status !== 'resolved') {
    target.append(element('p', workspace.status === 'choose' ? 'Choose the assignment you want to work on.' : 'No matching assignment in the accessible cache. Try another course or refresh after collection finishes.'));
    for (const choice of workspace.choices) {
      const button = element('button', `${choice.courseName} · ${choice.title}`, 'course-item');
      button.type = 'button';
      button.addEventListener('click', () => choose(choice));
      target.append(button);
    }
    return;
  }
  target.append(element('p', `${workspace.courseName} · ${workspace.stale ? 'Stale cache' : 'Cached'} · ${date(workspace.lastSuccess)}`, 'source-meta'));
  const overview = element('article', undefined, 'widget assignment-overview');
  overview.append(element('p', workspace.intent === 'submit' ? 'SUBMISSION CHECK' : 'YOUR ASSIGNMENT', 'eyebrow'),
    element('h3', `Due ${date(workspace.dueDate)}`), element('p', workspace.submissionStatus),
    element('p', `Opens ${date(workspace.startDate)} · Closes ${date(workspace.endDate)}`, 'source-meta'),
    sourceLink(workspace, demo, 'Open submission dropbox in Brightspace ↗'));
  target.append(overview);
  const grid = element('div', undefined, 'assignment-grid');
  for (const record of [...workspace.records, ...workspace.supporting]) {
    const card = element('article', undefined, 'widget assignment-card');
    card.dataset.category = record.category;
    card.append(element('p', record.reason || labels[record.status], 'eyebrow'), element('h3', record.title));
    if (record.text) {
      const details = element('details');
      details.open = ['instructions', 'rubric'].includes(record.category);
      details.append(element('summary', 'Read source'), element('p', record.text, 'assignment-text'));
      card.append(details);
    } else card.append(element('p', record.status === 'available' ? 'No text in the cached response. Check Brightspace for details.' : `${labels[record.status]}. Check Brightspace or refresh after collection finishes.`));
    card.append(element('p', `${labels[record.status]} · Last retrieved ${date(record.lastSuccess)}`, 'source-meta'), sourceLink(record, demo,
      record.reason ? 'Open source in Brightspace ↗' : 'Open assignment in Brightspace ↗'));
    grid.append(card);
  }
  target.append(grid, element('p', 'Follow-up questions use this assignment. Choose New search or change course to clear it. Cached submissions do not confirm current submission status.', 'retrieval-note'));
}

function renderTask(target, workspace, demo) {
  const heading = element('h2', workspace.title);
  heading.id = 'assignment-heading';
  heading.tabIndex = -1;
  target.append(element('p', 'YOUR WORKSPACE', 'eyebrow'), heading, element('p', workspace.goal));
  if (workspace.question) {
    const question = element('p', workspace.question, 'notice');
    question.setAttribute('role', 'status');
    target.append(question);
  }
  if (workspace.catalogueCount < workspace.total) target.append(element('p',
    `Planned from ${workspace.catalogueCount} of ${workspace.total} cached records. Narrow the course or describe the missing topic if needed.`, 'retrieval-note'));
  for (const section of workspace.sections) {
    const group = element('section', undefined, 'task-section');
    group.append(element('h3', section.title), element('p', section.purpose, 'retrieval-note'));
    const grid = element('div', undefined, 'assignment-grid');
    for (const source of section.sources) {
      const card = element('article', undefined, 'widget assignment-card');
      card.dataset.category = source.category;
      const citation = workspace.context.sourceIds.indexOf(source.id) + 1;
      if (citation && !target.querySelector(`#answer-source-${citation}`)) {
        card.id = `answer-source-${citation}`;
        card.tabIndex = -1;
      }
      card.append(element('p', `${source.courseName} · ${labels[source.status] || 'Cached'}`, 'eyebrow'), element('h4', source.title));
      if (source.dueDate) card.append(element('p', `Due ${date(source.dueDate)}`));
      const details = element('details');
      details.open = section.sources.length <= 3;
      details.append(element('summary', 'Read source'), element('p', source.text, 'assignment-text'));
      card.append(details, element('p', `${source.stale ? 'Stale cache' : labels[source.status] || 'Cached'} · Last retrieved ${date(source.lastSuccess)}`, 'source-meta'),
        sourceLink(source, demo, source.url.includes('/dropbox/') ? 'Open assignment in Brightspace ↗' : 'Open course in Brightspace ↗'));
      grid.append(card);
    }
    group.append(grid);
    target.append(group);
  }
  target.append(element('p', 'Describe what you want to do next to adapt this workspace. New search clears its goal. All records reflect the local cache.', 'retrieval-note'));
}
