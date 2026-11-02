import { validAnswerView } from './answer-view.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function references(ids, sources) {
  const links = element('div', undefined, 'answer-references');
  for (const id of [...new Set(ids)]) {
    const source = sources[id - 1];
    const link = element('a', `[${id}]${source.stale ? ' · Stale cache' : ''}`);
    link.href = `#answer-source-${id}`;
    link.setAttribute('aria-label', `Source ${id}: ${source.title}${source.stale ? ', stale cache' : ''}`);
    links.append(link);
  }
  return links;
}

export function renderAnswerView(target, view, sources) {
  target.replaceChildren();
  if (!validAnswerView(view, sources.length)) return false;
  for (const section of view.sections) {
    const card = element('article', undefined, `widget generated-card answer-${section.type}`);
    const edition = element('div', undefined, 'widget-edition');
    edition.append(element('span', { checklist: 'STUDY / CHECKLIST', comparison: 'COURSEWORK / COMPARE', cards: 'SOURCES / COLLECTION' }[section.type]), element('span', 'dd2l'));
    const header = element('header', undefined, 'widget-header');
    header.append(element('h3', section.title));
    card.append(edition, header);
    if (section.type === 'checklist') {
      const progress = element('p', `0 of ${section.items.length} complete`, 'answer-progress');
      progress.setAttribute('role', 'status');
      const list = element('ul', undefined, 'answer-checklist');
      let completed = 0;
      for (const item of section.items) {
        const row = element('li');
        const label = element('label');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => {
          completed += checkbox.checked ? 1 : -1;
          row.classList.toggle('completed', checkbox.checked);
          progress.textContent = `${completed} of ${section.items.length} complete`;
        });
        label.append(checkbox, element('span', item.text));
        row.append(label, references(item.citations, sources));
        list.append(row);
      }
      card.append(progress, list, element('small', 'Checks are kept for this answer only.', 'answer-session-note'));
    } else if (section.type === 'comparison') {
      const scroll = element('div', undefined, 'answer-table-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', section.title);
      const table = element('table');
      table.append(element('caption', section.title, 'sr-only'));
      const head = element('thead'), heading = element('tr');
      for (const title of [...section.columns, 'Sources']) {
        const cell = element('th', title); cell.scope = 'col'; heading.append(cell);
      }
      head.append(heading);
      const body = element('tbody');
      for (const row of section.rows) {
        const tr = element('tr');
        for (const [index, value] of row.cells.entries()) {
          const cell = element(index ? 'td' : 'th', value);
          if (!index) cell.scope = 'row';
          tr.append(cell);
        }
        const citations = element('td'); citations.append(references(row.citations, sources)); tr.append(citations);
        body.append(tr);
      }
      table.append(head, body); scroll.append(table); card.append(scroll);
    } else {
      const list = element('div', undefined, 'answer-source-cards');
      for (const item of section.cards) {
        const entry = element('section');
        entry.append(element('h4', item.title), element('p', item.text), references(item.citations, sources));
        list.append(entry);
      }
      card.append(list);
    }
    target.append(card);
  }
  return true;
}
