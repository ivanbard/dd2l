export const canvasSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 160 },
    answer: { type: 'string', maxLength: 6000 },
    html: { type: 'string', maxLength: 60_000 },
    css: { type: 'string', maxLength: 20_000 },
    js: { type: 'string', maxLength: 60_000 },
  },
  required: ['title', 'answer', 'html', 'css', 'js'],
};

export function validCanvas(value) {
  const fields = { title: 160, answer: 6000, html: 60_000, css: 20_000, js: 60_000 };
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 5 && Object.entries(fields).every(([key, size]) =>
      typeof value[key] === 'string' && value[key].length <= size) && !!value.title.trim() && !!value.html.trim();
}

export function validCanvasState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const queue = [[value, 0]];
  let nodes = 0;
  while (queue.length) {
    const [item, depth] = queue.pop();
    if (++nodes > 4000 || depth > 12) return false;
    if (item === null || typeof item === 'boolean' || typeof item === 'string') continue;
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item !== 'object') return false;
    if (Object.keys(item).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) return false;
    for (const child of Object.values(item)) queue.push([child, depth + 1]);
  }
  try { return JSON.stringify(value).length <= 32_000; } catch { return false; }
}

export function validCanvasContext(value) {
  return value === null || (!!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['program', 'state', 'error'].includes(key)) &&
    (value.error === undefined || (typeof value.error === 'string' && value.error.length <= 600)) &&
    validCanvas(value.program) && validCanvasState(value.state));
}
