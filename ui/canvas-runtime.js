// This function is embedded by the server in a dedicated opaque-origin frame.
export function canvasRuntime(validState) {
  'use strict';
  function workerRuntime() {
    let run, state, sources, initial;
    self.onmessage = ({ data }) => {
      try {
        if (data.type === 'init') {
          state = data.state;
          sources = data.sources;
          initial = data.html;
          run = new Function('state', 'event', 'sources', `"use strict";\n${data.js}`);
        }
        const event = data.event || { type: 'init', action: '', target: {}, values: {} };
        const inputs = { ...state.inputs, ...(event.type === 'init' ? {} : event.values) };
        state.inputs = inputs;
        const result = run(state, event, sources) || {};
        state = result.state || state;
        state.inputs = { ...inputs, ...state.inputs };
        initial = result.html ?? initial;
        self.postMessage({ type: 'render', html: initial, state });
      } catch (error) { self.postMessage({ type: 'error', message: String(error.message).slice(0, 500) }); }
    };
  }

  const root = document.getElementById('canvas');
  const style = document.getElementById('generated-style');
  const tags = new Set('a article aside b blockquote br button caption circle code col colgroup dd defs details div dl dt ellipse em fieldset figcaption figure footer form g h1 h2 h3 h4 h5 h6 header hr i input label legend li line lineargradient main marker nav ol optgroup option p path polygon polyline pre progress rect section select small span stop strong sub summary sup svg table tbody td text textarea th thead time tr tspan ul'.split(' '));
  const attributes = new Set('id class title role style name type value checked selected disabled readonly required min max step minlength maxlength placeholder rows cols multiple for open colspan rowspan scope datetime tabindex viewbox d x y x1 x2 y1 y2 cx cy r rx ry width height points fill stroke stroke-width stroke-linecap stroke-linejoin transform opacity offset stop-color marker-end preserveaspectratio'.split(' '));
  let port, worker, timer, pending = 0, state = {}, snapshotRequests = [], active = false, rendered = false, currentHtml = '';
  const send = data => port?.postMessage(data);

  function sanitize(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const visit = parent => {
      for (const node of [...parent.children]) {
        if (!tags.has(node.localName.toLowerCase()) || !['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'].includes(node.namespaceURI)) { node.remove(); continue; }
        for (const attribute of [...node.attributes]) {
          const name = attribute.name.toLowerCase();
          if (!attributes.has(name) && !name.startsWith('aria-') && !['data-action', 'data-source'].includes(name)) node.removeAttribute(attribute.name);
        }
        if (node.localName === 'input' && !['text', 'number', 'range', 'checkbox', 'radio', 'search', 'email', 'time', 'date', 'color', 'button', 'submit'].includes(node.type)) node.type = 'text';
        if (['input', 'textarea', 'select', 'form'].includes(node.localName)) node.setAttribute('autocomplete', 'off');
        if (node.localName === 'textarea' || (node.localName === 'input' && ['text', 'search', 'email'].includes(node.type))) {
          node.maxLength = node.maxLength > 0 ? Math.min(4000, node.maxLength) : 4000;
        }
        visit(node);
      }
    };
    visit(template.content);
    return template.content;
  }

  function controls() {
    const values = {};
    for (const field of root.querySelectorAll('input,textarea,select')) {
      const key = field.name || field.id;
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      if (field.type === 'radio' && !field.checked && values[key]?.checked) continue;
      values[key] = { value: field.value.slice(0, 4000), checked: !!field.checked };
      if (field.localName === 'select' && field.multiple) values[key].values = [...field.selectedOptions].map(option => option.value);
    }
    return values;
  }

  function restore() {
    for (const field of root.querySelectorAll('input,textarea,select')) {
      const saved = state.inputs?.[field.name || field.id];
      if (!saved) continue;
      if (field.type === 'radio') { field.checked = !!saved.checked && field.value === saved.value; continue; }
      if (field.localName === 'select' && field.multiple && Array.isArray(saved.values)) {
        for (const option of field.options) option.selected = saved.values.includes(option.value);
        continue;
      }
      field.value = saved.value;
      if (['checkbox', 'radio'].includes(field.type)) field.checked = saved.checked;
    }
  }

  function snapshots() {
    if (!pending) for (const id of snapshotRequests.splice(0)) send({ type: 'snapshot', id, state });
  }

  function stop(message) {
    worker?.terminate();
    worker = null;
    clearTimeout(timer);
    pending = 0;
    if (!rendered) root.textContent = 'The workspace could not run. Open Sources or describe what to fix.';
    send({ type: 'error', message });
    snapshots();
  }

  function dispatch(data) {
    if (!worker) return;
    if (++pending > 100) { stop('Too many workspace updates. Restart the workspace to continue.'); return; }
    if (!timer) timer = setTimeout(() => stop('The generated workspace took too long to respond. Your last saved progress is retained.'), 2000);
    worker.postMessage(data);
  }

  addEventListener('message', event => {
    if (active || event.source !== parent || !event.ports[0] || event.data?.type !== 'canvas-init') return;
    active = true;
    port = event.ports[0];
    state = validState(event.data.state) ? event.data.state : {};
    style.textContent = event.data.program.css;
    root.textContent = 'Opening workspace…';
    port.onmessage = ({ data }) => {
      if (data.type === 'snapshot') { snapshotRequests.push(data.id); snapshots(); }
    };
    const url = URL.createObjectURL(new Blob([`(${workerRuntime.toString()})()`], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') { stop(`Workspace error: ${data.message}`); return; }
      if (data.type !== 'render' || typeof data.html !== 'string' || data.html.length > 120_000 || !validState(data.state)) {
        stop('The workspace returned an invalid update. Your last saved progress is retained.'); return;
      }
      const focused = document.activeElement;
      const focusKey = focused?.name || focused?.id;
      const selection = [focused?.selectionStart, focused?.selectionEnd];
      state = data.state;
      pending = Math.max(0, pending - 1);
      // Older worker results must not replace controls while newer input is queued.
      if (!pending) {
        if (data.html !== currentHtml) { root.replaceChildren(sanitize(data.html)); currentHtml = data.html; }
        if (!rendered) requestAnimationFrame(() => requestAnimationFrame(() => send({ type: 'ready' })));
        rendered = true;
        restore();
      }
      if (!pending && focusKey) {
        const field = [...root.querySelectorAll('input,textarea,select,button')].find(item => (item.name || item.id) === focusKey);
        field?.focus({ preventScroll: true });
        try { if (selection[0] != null) field?.setSelectionRange(...selection); } catch {}
      }
      clearTimeout(timer); timer = null;
      if (pending) timer = setTimeout(() => stop('The workspace stopped responding. Your last saved progress is retained.'), 2000);
      send({ type: 'state', state });
      snapshots();
    };
    worker.onerror = () => stop('The generated workspace could not run. Your sources remain available.');
    dispatch({ type: 'init', ...event.data.program, state, sources: event.data.sources });
    new ResizeObserver(() => send({ type: 'height', height: Math.min(1600, Math.max(360, document.documentElement.scrollHeight)) })).observe(root);
  });

  for (const type of ['click', 'input', 'change', 'submit']) root.addEventListener(type, event => {
    if (type === 'submit') event.preventDefault();
    if (!event.isTrusted && !['input', 'change'].includes(type)) return;
    const source = event.target.closest('[data-source]');
    if (type === 'click' && source) { event.preventDefault(); send({ type: 'source', id: source.dataset.source }); return; }
    const target = event.target;
    const action = target.closest('[data-action]')?.dataset.action || '';
    if (type === 'click' && !action) return;
    dispatch({ type: 'event', event: { type, action: action.slice(0, 160),
      target: { id: target.id, name: target.name || '', value: String(target.value || '').slice(0, 4000), checked: !!target.checked }, values: controls() } });
  });
}
