// SIDEBAR TILE FX: adds the little effect layer inside each left-menu tile (scan-line sweep, neon edge, click ripple)
// and a gentle 3D tilt toward the mouse. Looks live in styles.css (".nx-*" and ".nav:hover" rules at the end).
// Light on purpose: only transform/opacity, one rAF per mouse move. Skipped for reduced-motion and on the phone remote.
(() => {
  'use strict';
  if (window.hs && hs.remote) return;
  const side = document.querySelector('.side');
  if (!side) return;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const addFx = (n) => { if (!n.querySelector(':scope > .nx-fx')) { const i = document.createElement('i'); i.className = 'nx-fx'; n.prepend(i); } };
  const all = () => side.querySelectorAll(':scope > .nav');
  all().forEach(addFx);
  try { new MutationObserver(() => all().forEach(addFx)).observe(side, { childList: true }); } catch {}
  if (reduced && reduced.matches) return; // CSS still gives the static hover look

  let tile = null, raf = 0, mx = 0, my = 0;
  const apply = () => {
    raf = 0;
    if (!tile) return;
    const r = tile.getBoundingClientRect();
    const px = (mx - r.left) / r.width - 0.5, py = (my - r.top) / r.height - 0.5;
    tile.style.setProperty('--nx-ry', `${(px * 16).toFixed(1)}deg`);
    tile.style.setProperty('--nx-rx', `${(-py * 16).toFixed(1)}deg`);
  };
  const reset = (t) => { if (t) { t.style.removeProperty('--nx-rx'); t.style.removeProperty('--nx-ry'); } };
  side.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.nav');
    if (t !== tile) { reset(tile); tile = t; }
    if (!t || side.classList.contains('reorder') || t.classList.contains('dragging')) return;
    mx = e.clientX; my = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  });
  side.addEventListener('pointerleave', () => { reset(tile); tile = null; });
  side.addEventListener('pointerdown', (e) => {
    const t = e.target.closest && e.target.closest('.nav');
    const fx = t && t.querySelector(':scope > .nx-fx');
    if (!fx) return;
    const r = t.getBoundingClientRect();
    const d = document.createElement('i'); d.className = 'nx-rip';
    d.style.left = `${e.clientX - r.left}px`; d.style.top = `${e.clientY - r.top}px`;
    fx.appendChild(d); setTimeout(() => d.remove(), 700);
  });
})();
