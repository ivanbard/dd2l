import { reduce, validPlan } from './model.mjs';

export function connectRenderer(render) {
  let port, current, sequence = 0, pending = [];
  const display = () => render({ ...current, action, source });
  const action = value => {
    if (!current) return;
    const seq = ++sequence;
    pending.push({ seq, action: value, revision: current.revision });
    current = { ...current, state: reduce(current.plan, current.state, value) };
    display();
    port.postMessage({ type: 'action', action: value, seq, revision: current.revision });
  };
  const source = id => port?.postMessage({ type: 'source', id });
  addEventListener('message', event => {
    if (port || event.source !== parent || event.data?.type !== 'comparison-init' || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (data.type !== 'render' || !validPlan(data.plan, data.sources)) return;
      pending = pending.filter(item => item.seq > data.ack && item.revision === data.revision);
      current = { ...data, state: pending.reduce((state, item) => reduce(data.plan, state, item.action), data.state) };
      display();
      requestAnimationFrame(() => requestAnimationFrame(() => port.postMessage({ type: 'painted' })));
    };
    port.start();
    port.postMessage({ type: 'connected' });
  });
  parent.postMessage({ type: 'comparison-ready' }, '*');
}

export function completion(plan, state) {
  const items = plan.sections.flatMap(section => section.items || []);
  return { total: items.length, done: items.filter(item => state.values[item.id]).length };
}
