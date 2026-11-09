import { validCanvas, validCanvasState } from './canvas-contract.js';

export function createCanvas(target, report) {
  let program, state = {}, frame, port, requestId = 0, generation = 0, lastError = '';
  const snapshots = new Map();
  const inspector = document.getElementById('canvas-source');
  let sourceRequest;

  function clear() {
    generation++;
    sourceRequest?.abort();
    port?.close(); port = null;
    for (const { reject, timer } of snapshots.values()) { clearTimeout(timer); reject(new Error('Workspace changed. Please send your request again.')); }
    snapshots.clear();
    frame?.remove(); frame = null;
    target.hidden = true;
    inspector.hidden = true;
    inspector.replaceChildren();
    program = undefined; state = {}; lastError = '';
  }

  async function inspect(id, sources, current) {
    if (!sources.some(source => source.id === id)) return;
    sourceRequest?.abort();
    const controller = sourceRequest = new AbortController();
    try {
      const response = await fetch(`/api/source?${new URLSearchParams({ id })}`, { signal: controller.signal });
      const source = await response.json();
      if (!response.ok) throw new Error(source.error || 'This source is no longer available.');
      if (generation !== current || sourceRequest !== controller) return;
      const title = document.createElement('h3'); title.textContent = source.title; title.tabIndex = -1;
      const status = document.createElement('p'); status.className = 'source-meta';
      status.textContent = `${source.courseName} · ${source.stale ? 'Stale cache' : 'Cached'} · ${source.lastSuccess || 'Retrieval date unknown'}`;
      const text = document.createElement('p'); text.className = 'assignment-text'; text.textContent = source.text;
      const link = document.createElement('a'); link.textContent = 'Open in Brightspace ↗';
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      inspector.replaceChildren(title, status, text, link); inspector.hidden = false; title.focus();
    } catch (error) { if (error.name !== 'AbortError' && generation === current) report(error.message); }
  }

  function render(next, sources, savedState = state) {
    if (!validCanvas(next) || !validCanvasState(savedState)) throw new Error('The generated workspace could not be verified.');
    clear();
    program = next; state = savedState;
    const current = generation;
    frame = document.createElement('iframe');
    frame.title = next.title;
    frame.className = 'generated-canvas';
    frame.dataset.ready = 'false';
    frame.inert = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.addEventListener('load', () => {
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = ({ data }) => {
        if (generation !== current || !data || typeof data !== 'object') return;
        if (['state', 'snapshot'].includes(data.type) && validCanvasState(data.state)) {
          state = data.state;
          if (data.type === 'snapshot' && snapshots.has(data.id)) {
            const pending = snapshots.get(data.id); snapshots.delete(data.id); clearTimeout(pending.timer);
            pending.resolve({ program, state: structuredClone(state), error: lastError });
          }
        } else if (data.type === 'ready') {
          frame.inert = false;
          // Let Chrome update iframe input routing after removing inert.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (generation !== current || frame.inert) return;
            frame.focus({ preventScroll: true });
            frame.dataset.ready = 'true';
          }));
        }
        else if (data.type === 'height' && Number.isFinite(data.height)) frame.style.height = `${Math.min(1600, Math.max(360, data.height))}px`;
        else if (data.type === 'error' && typeof data.message === 'string') {
          frame.inert = true;
          lastError = data.message.slice(0, 600); report(lastError);
        }
        else if (data.type === 'source' && typeof data.id === 'string') inspect(data.id, sources, current);
      };
      frame.contentWindow.postMessage({ type: 'canvas-init', program,
        state, sources: sources.map(({ id, title, courseName, category, excerpt, dueDate, stale }) => ({ id, title, courseName, category, text: excerpt, dueDate, stale })) }, '*', [channel.port2]);
    }, { once: true });
    frame.src = '/canvas-frame';
    target.replaceChildren(frame); target.hidden = false;
  }

  function snapshot() {
    if (!program) return Promise.resolve(null);
    if (!port) return Promise.reject(new Error('The workspace is still loading. Please try again.'));
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { snapshots.delete(id); reject(new Error('The workspace is still updating. Please try again.')); }, 3000);
      snapshots.set(id, { resolve, reject, timer });
      port.postMessage({ type: 'snapshot', id });
    });
  }

  return { render, clear, snapshot };
}
