import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceView } from './workspace-view.jsx';
import { validComponents, validComponentState, componentAction } from '../ui/component-contract.js';

const rootElement = document.getElementById('root');
const root = createRoot(rootElement, { onUncaughtError: () => {
  failed = true; send({ type: 'error', message: 'The workspace could not render. Your saved work is retained; reopen it or export its draft from Saved work.' });
} });
let port, program, state, sources, failed = false, saveStatus = 'Saving locally…';
const send = message => port?.postMessage(message);
const display = () => root.render(<WorkspaceView plan={program} state={state} sources={sources} saveStatus={saveStatus}
  action={action => {
    const next = componentAction(program, state, action);
    if (next === state) return;
    state = next; saveStatus = 'Saving locally…'; display(); send({ type: 'state', state });
  }} source={id => send({ type: 'source', id })} exportDraft={() => send({ type: 'export' })} />);

addEventListener('message', event => {
  if (port || event.source !== parent || event.data?.type !== 'components-init' || !event.ports[0]) return;
  const data = event.data;
  if (!validComponents(data.program, data.sources) || !validComponentState(data.program, data.state)) return;
  port = event.ports[0]; program = data.program; state = data.state; sources = data.sources;
  port.onmessage = ({ data }) => {
    if (data.type === 'snapshot') send({ type: 'snapshot', id: data.id, state });
    else if (data.type === 'save-status' && typeof data.message === 'string') { saveStatus = data.message.slice(0, 300); display(); }
  };
  display();
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!failed) { send({ type: 'ready' }); send({ type: 'state', state }); } }));
  new ResizeObserver(() => send({ type: 'height', height: rootElement.scrollHeight + 24 })).observe(rootElement);
});
