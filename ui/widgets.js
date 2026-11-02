import { defaults, fits, firstSpace, restore, sizes } from './widget-layout.js';
import { startLoading } from './loading.js';

const $ = id => document.getElementById(id);
const names = { deadlines: 'Upcoming deadlines', announcements: 'Class announcements', shortcuts: 'Your shortcuts' };
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const button = (label, action, cls) => {
  const el = node('button', label, cls);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
};
const date = value => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function createWidgets(browse) {
  let data, layout = [], pins = [], editing = false, storageKey;
  const message = text => { $('widget-status').textContent = text; };
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ layout, pins })); }
    catch { message('Your changes work for this visit, but this browser could not save them.'); }
  }
  function move(widget, change) {
    const next = { ...widget, ...change };
    if (!fits(layout, next)) { message('That space is occupied or outside the grid. Move another widget first.'); return; }
    Object.assign(widget, next);
    message(`${names[widget.type]} moved to column ${widget.x + 1}, row ${widget.y + 1}.`);
    render(); save();
    $(`widget-${widget.type}`)?.focus();
  }
  function place(tile, widget) {
    tile.className = `widget widget-${widget.type} col-${widget.x} row-${widget.y} size-${widget.size}`;
    const [w, h] = sizes[widget.size];
    tile.style.gridColumnEnd = `span ${w}`;
    tile.style.gridRowEnd = `span ${h}`;
  }
  function customize(tile, widget) {
    tile.tabIndex = 0;
    tile.setAttribute('aria-describedby', 'widget-help');
    tile.addEventListener('keydown', event => {
      if (event.target !== tile && !event.target.classList.contains('widget-resize')) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const [dx, dy] = delta, [w, h] = sizes[widget.size];
      move(widget, event.shiftKey || event.target !== tile ? { size: `${w + dx}x${h + dy}` } : { x: widget.x + dx, y: widget.y + dy });
    });
    tile.addEventListener('click', event => {
      if (event.target.closest('.widget-item, .shortcut-link')) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    tile.addEventListener('pointerdown', event => {
      const edge = event.target.closest('.widget-resize')?.dataset.edge;
      if (event.button !== 0 || (!edge && event.target.closest('button:not(.widget-drag):not(.widget-item):not(.shortcut-link), a, input, select'))) return;
      event.preventDefault();
      tile.focus({ preventScroll: true });
      const grid = $('widget-grid'), rect = tile.getBoundingClientRect();
      const cell = (grid.getBoundingClientRect().width + 16) / 4;
      const startX = event.clientX, startY = event.clientY, scrollX = window.scrollX, scrollY = window.scrollY;
      const [w, h] = sizes[widget.size];
      const preview = node('div');
      preview.setAttribute('aria-hidden', 'true');
      let next = { ...widget }, changed = false;
      grid.append(preview);
      function update(e) {
        const dx = e.clientX - startX + window.scrollX - scrollX, dy = e.clientY - startY + window.scrollY - scrollY;
        changed ||= Math.abs(dx) + Math.abs(dy) > 4;
        const left = edge?.includes('w') ? dx : 0, top = edge?.includes('n') ? dy : 0;
        const width = Math.max(80, rect.width + (edge?.includes('e') ? dx : -left));
        const height = Math.max(80, rect.height + (edge?.includes('s') ? dy : -top));
        tile.style.transform = `translate(${edge ? left : dx}px, ${edge ? top : dy}px)`;
        if (edge) { tile.style.width = `${width}px`; tile.style.height = `${height}px`; }
        const x = widget.x + Math.round((edge ? left : dx) / cell);
        const y = widget.y + Math.round((edge ? top : dy) / 176);
        next = { ...widget, x, y, size: edge ? `${Math.round((width + 16) / cell)}x${Math.round((height + 16) / 176)}` : widget.size };
        const valid = fits(layout, next);
        // Invalid dimensions have no grid span; keep the last cell preview and mark it blocked.
        if (Object.hasOwn(sizes, next.size) && x >= 0 && x < 4 && y >= 0 && y < 8) place(preview, next);
        preview.classList.add('widget-preview');
        preview.classList.toggle('blocked', !valid);
        tile.classList.toggle('blocked', !valid);
      }
      function finish(commit) {
        tile.removeEventListener('pointermove', update);
        tile.removeEventListener('pointerup', up);
        tile.removeEventListener('pointercancel', cancel);
        tile.removeEventListener('lostpointercapture', cancel);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('blur', cancel);
        preview.remove();
        if (tile.hasPointerCapture(event.pointerId)) tile.releasePointerCapture(event.pointerId);
        if (commit && changed) move(widget, next);
        // A canceled or blocked gesture restores the original geometry without saving.
        if (tile.isConnected) { tile.removeAttribute('style'); place(tile, widget); }
      }
      const up = e => { update(e); finish(true); };
      const cancel = () => finish(false);
      const escape = e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
      tile.setPointerCapture(event.pointerId);
      tile.classList.add('dragging');
      tile.addEventListener('pointermove', update);
      tile.addEventListener('pointerup', up);
      tile.addEventListener('pointercancel', cancel);
      tile.addEventListener('lostpointercapture', cancel);
      document.addEventListener('keydown', escape);
      window.addEventListener('blur', cancel);
      update(event);
    });
    for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
      const grip = button('', () => {}, `widget-resize resize-${edge}`);
      grip.tabIndex = -1;
      grip.dataset.edge = edge;
      grip.setAttribute('aria-label', `Resize ${names[widget.type]} ${edge}`);
      tile.append(grip);
    }
  }
  function choose(title, items, action) {
    $('panel-title').textContent = title;
    $('panel-body').replaceChildren();
    const filter = node('input');
    filter.type = 'search';
    filter.placeholder = 'Find a class or material…';
    filter.setAttribute('aria-label', 'Find a class or material');
    const list = node('div');
    const show = () => {
      list.replaceChildren();
      for (const item of items.filter(item => item.label.toLowerCase().includes(filter.value.toLowerCase()))) list.append(button(item.label, () => {
        action(item); $('panel').close();
      }, 'course-item'));
      if (!list.children.length) list.append(node('p', 'No available items.'));
    };
    if (items.length > 3) $('panel-body').append(filter);
    $('panel-body').append(list);
    filter.addEventListener('input', show);
    show();
    $('panel').showModal();
  }
  function pinPicker() {
    const items = [
      ...data.courses.map(c => ({ key: `course:${c.id}`, label: c.name })),
      ...data.sources.map(s => ({ key: `source:${s.ref}`, label: `${s.courseName} · ${s.title}` })),
    ];
    const unique = [...new Map(items.map(item => [item.key, item])).values()];
    choose('Pin a class or course material', unique.filter(item => !pins.includes(item.key)), item => {
      if (pins.length >= 20) { message('You can pin up to 20 shortcuts. Remove one to add another.'); return; }
      pins.push(item.key); save(); render();
    });
  }
  function sourceRow(source, detail) {
    const row = button('', () => browse(source.course, source.title), 'widget-item');
    row.append(node('small', `${source.courseName}${source.stale ? ' · Stale cache' : ''}`), node('strong', source.title));
    if (detail) row.append(node('span', detail));
    return row;
  }
  function render() {
    if (!data) return;
    const grid = $('widget-grid');
    grid.replaceChildren();
    grid.classList.toggle('editing', editing);
    $('customize-widgets').textContent = editing ? 'Done' : 'Customize';
    $('customize-widgets').setAttribute('aria-pressed', String(editing));
    $('add-widget').hidden = !editing;
    $('widget-help').textContent = editing ? 'Drag a widget to move it. Drag its edges or corners to resize. Arrow keys move a focused widget; Shift + arrows resize. Escape cancels a drag. Changes save automatically.' : 'From your cached coursework · Select an item to browse its source.';
    for (const widget of [...layout].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const tile = node('article', undefined, `widget widget-${widget.type} col-${widget.x} row-${widget.y} size-${widget.size}`);
      place(tile, widget);
      tile.id = `widget-${widget.type}`;
      tile.tabIndex = -1;
      tile.setAttribute('aria-label', names[widget.type]);
      const edition = node('div', undefined, 'widget-edition');
      edition.append(node('span', { deadlines: '01 / PLANNER', announcements: '02 / BULLETIN', shortcuts: '03 / COLLECTION' }[widget.type]), node('span', 'dd2l'));
      const mark = node('div', undefined, 'widget-mark');
      mark.setAttribute('aria-hidden', 'true');
      if (widget.type === 'deadlines') {
        const due = data.deadlines[0]?.dueDate;
        mark.append(node('span', due ? new Date(due).toLocaleDateString([], { day: '2-digit' }) : '—'),
          node('small', due ? new Date(due).toLocaleDateString([], { month: 'short' }).toUpperCase() : 'NO DUE DATE'));
      }
      tile.append(edition, mark);
      const header = node('header', undefined, 'widget-header');
      header.append(node('h3', names[widget.type]));
      if (widget.type === 'shortcuts') header.append(button('+ Pin shortcut', pinPicker, 'pin-shortcut'));
      if (editing) {
        const handle = button('⠿', () => {}, 'widget-drag');
        handle.setAttribute('aria-label', `Drag ${names[widget.type]}`);
        handle.tabIndex = -1;
        header.append(handle);
      }
      tile.append(header);
      if (editing) {
        const controls = node('div', undefined, 'widget-tools');
        controls.append(button('Remove', () => {
          layout = layout.filter(w => w !== widget); save(); render(); $('add-widget').focus();
        }));
        tile.append(controls);
      }
      const body = node('div', undefined, 'widget-body');
      if (widget.type === 'shortcuts') {
        for (const pin of pins) {
          const course = data.courses.find(c => pin === `course:${c.id}`);
          const source = data.sources.find(s => pin === `source:${s.ref}`);
          if (!course && !source) continue;
          const row = node('div', undefined, 'shortcut-row');
          row.append(button(course?.name || source.title, () => browse(course?.id || source.course, source?.title || ''), 'shortcut-link'));
          if (editing) {
            const remove = button('×', () => { pins = pins.filter(p => p !== pin); save(); render(); });
            remove.setAttribute('aria-label', `Unpin ${course?.name || source.title}`);
            row.append(remove);
          }
          body.append(row);
        }
        if (!body.children.length) body.append(node('p', 'Keep the classes and materials you use most within reach.', 'widget-empty'));
      } else {
        for (const source of data[widget.type]) body.append(sourceRow(source, widget.type === 'deadlines' ? `Due ${date(source.dueDate)}` : `${source.publishedAt ? date(source.publishedAt) + ' · ' : ''}${source.excerpt}`));
        if (!body.children.length) body.append(node('p', widget.type === 'deadlines' ? 'No upcoming deadlines in the cache. Sync onQ to check for updates.' : 'No announcements in the cache. Sync onQ to check for updates.', 'widget-empty'));
      }
      tile.append(body);
      if (editing) customize(tile, widget);
      grid.append(tile);
    }
    if (!layout.length) grid.append(node('p', 'Your homescreen is clear. Choose Add widget to get started.', 'widget-empty'));
  }
  $('customize-widgets').addEventListener('click', () => { editing = !editing; render(); });
  $('add-widget').addEventListener('click', () => choose('Add a widget', Object.entries(names)
    .filter(([type]) => !layout.some(w => w.type === type)).map(([type, label]) => ({ type, label })), ({ type }) => {
    const widget = firstSpace(layout, type);
    if (!widget) { message('The grid is full. Remove or resize a widget first.'); return; }
    layout.push(widget); save(); render();
  }));
  return async function refresh() {
    const finish = startLoading($('widget-loading'), 'Refreshing coursework widgets');
    $('refresh-widgets').disabled = true;
    try {
      const response = await fetch('/api/home');
      if (!response.ok) throw new Error('Could not refresh widgets. Try again.');
      const next = await response.json();
      const key = `dd2l:widgets:v1:${next.scope}`;
      if (storageKey !== key) {
        let stored;
        try { stored = restore(JSON.parse(localStorage.getItem(key))); } catch {}
        layout = stored?.layout || defaults();
        pins = stored?.pins || next.courses.slice(0, 2).map(c => `course:${c.id}`);
        storageKey = key;
      }
      data = next; render(); message('Widgets updated from the local cache.');
    } catch (error) { message(error.message); }
    finally { finish(); $('refresh-widgets').disabled = false; }
  };
}
