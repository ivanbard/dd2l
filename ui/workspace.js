import { createCanvas } from './canvas.js';
import { componentState, validComponents, validComponentState } from './component-contract.js';
import { validCanvas, validCanvasState } from './canvas-contract.js';

export function createWorkspace(target, report, changed, exportDraft) {
  const custom = createCanvas(target, report);
  let active, frame, port, readyTimer, generation = 0, requestId = 0;
  const pending = new Map();
  const clearComponents = () => {
    generation++; clearTimeout(readyTimer); port?.close(); port = null; frame?.remove(); frame = null; active = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Workspace changed. Please retry.')); }
    pending.clear();
  };
  const snapshotValue = () => ({ program: active.program, state: structuredClone(active.state), error: '' });
  return {
    clear() { clearComponents(); custom.clear(); },
    setSaveStatus(message) { port?.postMessage({ type: 'save-status', message }); },
    render(program, sources, previousState = {}, previousProgram) {
      if (!validComponents(program)) {
        const state = previousProgram?.sections ? {} : previousState;
        if (!validCanvas(program) || !validCanvasState(state)) throw new Error('The generated workspace could not be verified.');
        clearComponents(); custom.render(program, sources, state); return;
      }
      if (!validComponents(program, sources)) throw new Error('Some workspace sources are no longer available. Your current draft has been retained.');
      const state = componentState(program, previousProgram, previousProgram?.sections ? previousState : undefined);
      if (!validComponentState(program, state)) throw new Error('The new layout exceeds the saved-work limit. Your existing draft is retained; export it before simplifying the workspace.');
      clearComponents(); custom.clear();
      active = { program, state };
      const current = generation;
      frame = document.createElement('iframe'); frame.className = 'generated-canvas generated-components'; frame.title = program.title;
      frame.dataset.ready = 'false'; frame.inert = true;
      frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
      frame.addEventListener('load', () => {
        const channel = new MessageChannel(); port = channel.port1;
        port.onmessage = ({ data }) => {
          if (current !== generation || !data || typeof data !== 'object') return;
          if (['state', 'snapshot'].includes(data.type) && validComponentState(program, data.state)) {
            active.state = data.state;
            if (data.type === 'state') changed(snapshotValue());
            else if (pending.has(data.id)) { const item = pending.get(data.id); pending.delete(data.id); clearTimeout(item.timer); item.resolve(snapshotValue()); }
          } else if (data.type === 'ready') {
            clearTimeout(readyTimer);
            frame.inert = false;
            requestAnimationFrame(() => requestAnimationFrame(() => { if (current === generation) frame.dataset.ready = 'true'; }));
          } else if (data.type === 'source' && typeof data.id === 'string') custom.inspectSource(data.id, sources);
          else if (data.type === 'error' && typeof data.message === 'string') { clearTimeout(readyTimer); frame.inert = true; report(data.message.slice(0, 600)); }
          else if (data.type === 'export') exportDraft(snapshotValue());
          else if (data.type === 'height' && Number.isFinite(data.height)) frame.style.height = `${Math.min(1600, Math.max(360, data.height))}px`;
        };
        frame.contentWindow.postMessage({ type: 'components-init', program, state, sources: sources.map(({ id, title, stale }) => ({ id, title, stale })) }, '*', [channel.port2]);
      }, { once: true });
      frame.src = '/component-frame'; target.replaceChildren(frame); target.hidden = false;
      readyTimer = setTimeout(() => { if (current === generation) report('The workspace is still loading. Reopen Saved work or retry; your saved draft has been retained.'); }, 10000);
    },
    snapshot() {
      if (!active) return custom.snapshot();
      if (!port) return Promise.reject(new Error('The workspace is still loading. Please try again.'));
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('The workspace is still loading. Please try again.')); }, 3000);
        pending.set(id, { resolve, reject, timer }); port.postMessage({ type: 'snapshot', id });
      });
    },
  };
}
