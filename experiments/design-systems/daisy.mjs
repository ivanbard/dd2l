import 'daisyui/daisyui.css';
import './frame.css';
import { completion, connectRenderer } from './frame.mjs';

const root = document.getElementById('root');
document.documentElement.dataset.theme = 'dark';
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const controls = new Map();
let signature;

connectRenderer(({ plan, state, action, source }) => {
  const nextSignature = JSON.stringify(plan);
  if (signature !== nextSignature) {
    signature = nextSignature;
    controls.clear();
    root.replaceChildren(node('p', 'FICTIONAL COURSEWORK', 'eyebrow'), node('h1', plan.title), node('p', plan.goal, 'goal'));
    root.append(node('p', '', 'completion'));
    const tabs = node('div', undefined, 'tabs tabs-border');
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace sections');
    for (const section of plan.sections) {
      const tab = node('button', section.title, 'tab');
      tab.type = 'button'; tab.id = `tab-${section.id}`;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `panel-${section.id}`);
      tab.addEventListener('click', () => action({ type: 'tab', id: section.id }));
      tab.addEventListener('keydown', event => {
        const buttons = [...tabs.children];
        const index = buttons.indexOf(tab);
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); buttons[next].focus(); buttons[next].click();
      });
      tabs.append(tab);
    }
    root.append(tabs);
    const cite = id => {
      const button = node('button', 'Read source', 'btn btn-ghost btn-sm'); button.type = 'button';
      button.addEventListener('click', () => source(id)); return button;
    };
    for (const section of plan.sections) {
      const panel = node('section', undefined, 'section-panel'); panel.id = `panel-${section.id}`;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${section.id}`);
      panel.tabIndex = 0;
      panel.append(node('h2', section.title));
      if (section.type === 'reading') {
        panel.append(node('p', section.text));
        for (const id of section.sourceIds) panel.append(cite(id));
      } else if (section.type === 'checklist') {
        const progress = node('progress', undefined, 'progress progress-primary'); progress.max = section.items.length;
        progress.setAttribute('aria-label', 'Requirement completion'); panel.append(progress);
        for (const item of section.items) {
          const row = node('div', undefined, 'requirement-row');
          const label = node('label', undefined, 'check-label');
          const input = node('input', undefined, 'checkbox checkbox-primary'); input.type = 'checkbox'; input.name = item.id;
          input.addEventListener('change', () => action({ type: 'value', id: item.id, value: input.checked }));
          controls.set(item.id, input); label.append(input, node('span', item.text)); row.append(label, cite(item.sourceId)); panel.append(row);
        }
      } else if (section.type === 'schedule') {
        const label = node('label', 'Planned work date', 'field-label');
        const input = node('input', undefined, 'input'); input.type = 'date'; input.name = section.id;
        input.addEventListener('change', () => action({ type: 'value', id: section.id, value: input.value }));
        controls.set(section.id, input); label.append(input); panel.append(label,
          node('p', 'Your plan date is a personal scenario, not a changed assignment deadline.', 'help'));
      } else if (section.type === 'notes') {
        const label = node('label', section.title, 'field-label');
        const input = node('textarea', undefined, 'textarea'); input.name = section.id; input.rows = 6; input.maxLength = 4000; input.placeholder = section.placeholder;
        input.addEventListener('input', () => action({ type: 'value', id: section.id, value: input.value }));
        controls.set(section.id, input); label.append(input); panel.append(label);
      } else if (section.type === 'rubric') {
        const scroll = node('div', undefined, 'table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Rubric table');
        const table = node('table', undefined, 'table'); table.append(node('caption', 'Fictional assignment rubric'));
        const head = node('thead'), header = node('tr');
        for (const name of ['Criterion', 'Points', 'Requirement']) { const cell = node('th', name); cell.scope = 'col'; header.append(cell); }
        head.append(header); table.append(head);
        const body = node('tbody');
        for (const row of section.rows) {
          const tr = node('tr'); const criterion = node('th', row.criterion); criterion.scope = 'row';
          const description = node('td'); description.append(node('p', row.description), cite(row.sourceId));
          tr.append(criterion, node('td', String(row.points)), description); body.append(tr);
        }
        table.append(body); scroll.append(table); panel.append(scroll);
      } else if (section.type === 'practice') {
        panel.append(node('p', 'Generated practice · not an official quiz', 'help'));
        for (const question of section.questions) {
          const fieldset = node('fieldset', undefined, 'practice-question'); fieldset.append(node('legend', question.prompt));
          const radios = [];
          question.choices.forEach((choice, index) => {
            const label = node('label', undefined, 'check-label');
            const input = node('input', undefined, 'radio radio-primary'); input.type = 'radio'; input.name = question.id; input.value = String(index);
            input.addEventListener('change', () => action({ type: 'value', id: question.id, value: index }));
            radios.push(input); label.append(input, node('span', choice)); fieldset.append(label);
          });
          const reveal = node('button', 'Check answer', 'btn btn-primary'); reveal.type = 'button';
          reveal.addEventListener('click', () => action({ type: 'reveal', id: question.id }));
          const feedback = node('p', '', 'alert'); feedback.setAttribute('role', 'status');
          fieldset.append(reveal, feedback, cite(question.sourceId)); panel.append(fieldset);
          controls.set(question.id, { radios, reveal, feedback });
        }
      }
      root.append(panel);
    }
  }
  const progress = completion(plan, state);
  root.querySelector('.completion').textContent = progress.total ? `${progress.done} of ${progress.total} requirements complete` : 'Try a question, then check your answer.';
  for (const section of plan.sections) {
    const tab = document.getElementById(`tab-${section.id}`), panel = document.getElementById(`panel-${section.id}`);
    const active = state.active === section.id;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    tab.classList.toggle('tab-active', active); panel.hidden = !active;
    if (section.type === 'checklist') panel.querySelector('progress').value = section.items.filter(item => state.values[item.id]).length;
    for (const question of section.questions || []) {
      const { radios, reveal, feedback } = controls.get(question.id);
      radios.forEach((input, index) => { input.checked = state.values[question.id] === index; });
      reveal.disabled = state.values[question.id] === null;
      feedback.hidden = !state.revealed[question.id];
      feedback.textContent = `${state.values[question.id] === question.answer ? 'Correct.' : 'Try again.'} ${question.explanation}`;
    }
  }
  for (const [id, input] of controls) {
    if (!(input instanceof HTMLElement)) continue;
    if (input.type === 'checkbox') input.checked = state.values[id];
    else if (input.value !== state.values[id]) input.value = state.values[id];
  }
});
