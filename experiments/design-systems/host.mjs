import { createState, generationPrompt, reduce, validPlan } from './model.mjs';

const $ = id => document.getElementById(id);
async function startComparison() {
const response = await fetch('/fixtures.json');
if (!response.ok) throw new Error('Could not load comparison fixtures.');
const { sources, scenarios } = await response.json();
const manifestResponse = await fetch('/manifest.json');
if (!manifestResponse.ok) throw new Error('Could not load comparison measurements.');
const manifest = await manifestResponse.json();
let plan = scenarios.planner;
if (!validPlan(plan, sources)) throw new Error('The comparison fixture is invalid.');
let state = createState(plan), sourceOpener, revision = 0;
const renderers = new Map();
const message = text => { $('status').textContent = text; };
const broadcast = () => { for (const renderer of renderers.values()) renderer.port.postMessage({ type: 'render', plan, state, sources, revision, ack: renderer.ack }); };
const refreshEditor = () => {
  $('plan').value = JSON.stringify(plan, null, 2); $('goal').value = plan.goal;
  $('prompt').value = generationPrompt(plan, sources);
};
const changePlan = (next, reset = false) => {
  state = createState(next, reset ? undefined : plan, reset ? undefined : state); plan = next;
  revision++;
  $('source').hidden = true; refreshEditor(); broadcast();
};
const showSource = (id, renderer) => {
  const record = sources.find(source => source.id === id);
  if (!record) return;
  sourceOpener = renderer;
  $('source-title').textContent = record.title; $('source-course').textContent = `${record.courseName} · fictional demo source`;
  $('source-text').textContent = record.text; $('source').hidden = false; $('source-title').focus();
};
const paintMetrics = id => {
  const metrics = manifest.renderers[id], renderer = renderers.get(id);
  $(`metrics-${id}`).textContent = `${(metrics.gzip / 1024).toFixed(1)} KiB gzip · ${(metrics.bytes / 1024).toFixed(1)} KiB raw · ${renderer?.firstPaint == null ? 'waiting for paint' : `first paint ${Math.round(renderer.firstPaint)} ms`}`;
};
addEventListener('message', event => {
  if (event.data?.type !== 'comparison-ready') return;
  const id = ['daisy', 'mantine'].find(id => $(id).contentWindow === event.source);
  if (!id || renderers.has(id)) return;
  const channel = new MessageChannel();
  const renderer = { port: channel.port1, firstPaint: null, ack: 0 };
  renderers.set(id, renderer);
  channel.port1.onmessage = ({ data }) => {
    if (data.type === 'connected') broadcast();
    else if (data.type === 'painted' && renderer.firstPaint === null) {
      renderer.firstPaint = performance.now() - starts.get(id); paintMetrics(id);
      if ([...renderers.values()].filter(renderer => renderer.firstPaint !== null).length === 2) message('Both renderers ready. Edits in either workspace stay in sync.');
    } else if (data.type === 'action' && Number.isSafeInteger(data.seq) && data.seq > renderer.ack) {
      renderer.ack = data.seq;
      if (data.revision === revision) state = reduce(plan, state, data.action);
      broadcast();
    }
    else if (data.type === 'source') showSource(data.id, id);
  };
  event.source.postMessage({ type: 'comparison-init' }, '*', [channel.port2]);
});
const starts = new Map();
for (const id of ['daisy', 'mantine']) {
  $(`version-${id}`).textContent = manifest.versions[id]; paintMetrics(id);
  starts.set(id, performance.now()); $(id).src = `/${id}.html`;
  $(id).addEventListener('error', () => message(`The ${id} renderer could not load. Rebuild and reload the comparison.`));
}
setTimeout(() => {
  const pending = ['daisy', 'mantine'].filter(id => renderers.get(id)?.firstPaint == null);
  if (pending.length) message(`Still waiting for ${pending.join(' and ')}. Check the browser console or rebuild the comparison.`);
}, 10_000);
refreshEditor();
$('scenario').addEventListener('change', () => { changePlan(scenarios[$('scenario').value], true); message('Task changed. Both workspaces start with the same empty progress.'); });
$('reset').addEventListener('click', () => { revision++; state = createState(plan); broadcast(); message('Progress reset in both workspaces.'); });
$('adapt').addEventListener('click', () => {
  changePlan({ ...plan, sections: [...plan.sections.filter(section => section.type === 'notes'), ...plan.sections.filter(section => section.type !== 'notes')] });
  message('Notes moved first. Existing notes, dates, checked items and practice answers are retained.');
});
$('view').addEventListener('change', () => {
  const view = $('view').value;
  $('comparison').classList.toggle('single', view !== 'both');
  for (const id of ['daisy', 'mantine']) $(`panel-${id}`).hidden = view !== 'both' && view !== id;
});
$('width').addEventListener('change', () => {
  for (const id of ['daisy', 'mantine']) $(id).style.width = $('width').value === 'fluid' ? '100%' : `${$('width').value}px`;
});
$('goal').addEventListener('input', () => { $('prompt').value = generationPrompt({ ...plan, goal: $('goal').value }, sources); });
$('copy-prompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('prompt').value); message('Generation prompt copied. Paste the model’s JSON response into the plan editor.'); }
  catch { $('prompt').focus(); $('prompt').select(); message('Clipboard unavailable. Copy the selected prompt manually.'); }
});
$('apply').addEventListener('click', () => {
  try {
    if ($('plan').value.length > 64_000) throw new Error('Plan too large');
    const next = JSON.parse($('plan').value);
    if (!validPlan(next, sources)) throw new Error('Invalid plan');
    changePlan(next); $('plan').removeAttribute('aria-invalid'); message('Plan applied to both renderers. Unchanged controls retain their progress.');
  } catch {
    $('plan').setAttribute('aria-invalid', 'true'); message('Plan rejected. Use the downloaded schema, unique IDs, real source IDs and valid dates. The current workspace and progress are retained.');
  }
});
$('close-source').addEventListener('click', () => { $('source').hidden = true; $(sourceOpener)?.focus(); });
$('export').addEventListener('click', () => {
  const report = { recordedAt: new Date().toISOString(), scenario: $('scenario').value, plan, state, sources,
    measurements: manifest, firstPaintMs: Object.fromEntries([...renderers].map(([id, renderer]) => [id, renderer.firstPaint])),
    observations: $('observations').value, scope: 'Shared-plan rendering comparison; no live model generation or production integration.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'dd2l-design-system-comparison.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); message('Comparison exported with the plan, progress, versions, measurements and observations.');
});
}
startComparison().catch(error => {
  $('status').textContent = 'The comparison could not start. Run npm run compare to rebuild, then reload.';
  console.error(error);
});
