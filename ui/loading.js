// Square 12 / Origin Wave, adapted for dd2l from zzzzshawn/matrix. See THIRD_PARTY_NOTICES.md.
const active = new WeakMap();

export function startLoading(target, label = 'Loading') {
  let state = active.get(target);
  if (!state) {
    const loader = document.createElement('span');
    loader.className = 'dot-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-label', label);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--ring', Math.abs(row - 1) + Math.abs(col - 1));
      loader.append(dot);
    }
    state = { loader, count: 0, previousBusy: target.getAttribute('aria-busy') };
    active.set(target, state);
    target.append(loader);
    target.setAttribute('aria-busy', 'true');
  }
  state.count++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (--state.count) return;
    state.loader.remove();
    if (state.previousBusy === null) target.removeAttribute('aria-busy');
    else target.setAttribute('aria-busy', state.previousBusy);
    active.delete(target);
  };
}
