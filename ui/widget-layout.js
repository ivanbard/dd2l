export const sizes = { small: [1, 1], wide: [2, 1], large: [2, 2], full: [4, 2],
  ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => {
    const w = i % 4 + 1, h = Math.floor(i / 4) + 1;
    return [`${w}x${h}`, [w, h]];
  })) };
export const defaults = () => [
  { type: 'deadlines', x: 0, y: 0, size: 'wide' },
  { type: 'announcements', x: 2, y: 0, size: 'large' },
  { type: 'shortcuts', x: 0, y: 1, size: 'wide' },
];

export function fits(layout, widget) {
  if (!Object.hasOwn(sizes, widget.size) || !Number.isInteger(widget.x) || !Number.isInteger(widget.y)) return false;
  const [w, h] = sizes[widget.size];
  if (widget.x < 0 || widget.x + w > 4 || widget.y < 0 || widget.y + h > 8) return false;
  return layout.every(other => {
    if (other.type === widget.type) return true;
    const [ow, oh] = sizes[other.size];
    return widget.x + w <= other.x || other.x + ow <= widget.x || widget.y + h <= other.y || other.y + oh <= widget.y;
  });
}

export function restore(value) {
  if (!value || !Array.isArray(value.layout) || value.layout.length > 3 || !Array.isArray(value.pins)) return null;
  const layout = [];
  for (const item of value.layout) {
    if (!item || !['deadlines', 'announcements', 'shortcuts'].includes(item.type) || layout.some(w => w.type === item.type) || !fits(layout, item)) return null;
    layout.push({ type: item.type, x: item.x, y: item.y, size: item.size });
  }
  return { layout, pins: [...new Set(value.pins.filter(pin => typeof pin === 'string' && pin.length < 2000))].slice(0, 20) };
}

export function firstSpace(layout, type, size = 'wide') {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const widget = { type, size, x, y };
    if (fits(layout, widget)) return widget;
  }
  return null;
}
