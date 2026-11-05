// SIDEBAR ORDER: drag any left-menu button to where you want it (press, move a few pixels, drop). Right-click a
// button for Move up/down and "Reset menu order" (ctxmenu.js). The order is saved twice: in localStorage ('navOrder')
// and in a small JSON file written by the main process (hs.uiState / hs.uiStateSet), because Chromium writes
// localStorage lazily and a quick or forced quit can lose it. The file wins at startup.
// This file also moves FILE ROUTER + SENSES under OPERATIONS and HARDWARE under FANS (collapsible sections) and
// redirects showView('router'|'senses'|'hardware'|'experts') to the new homes. Must load AFTER addons.js (so addon
// buttons exist) and BEFORE tabs.js (which reads the buttons once). Skipped on the phone remote.
(() => {
  if (hs.remote) return;
  const side = $('.side'), foot = $('.side-foot');
  if (!side || !foot) return;

  // ---- moved pages: collapsible sections inside OPERATIONS and FANS ----
  const MOVED = { router: 'nexus', senses: 'nexus', hardware: 'afterburner', experts: 'ai' };
  window.hsMovedViews = MOVED;
  const FOLDS = [['router', 'FILE ROUTER · auto-sort downloads', 'nexus'], ['senses', 'SENSES · mic and camera privacy', 'nexus'], ['hardware', 'HARDWARE · USB ports and power', 'afterburner']];
  for (const [name, label, host] of FOLDS) {
    const el = $(`#view-${name}`), h = $(`#view-${host}`);
    if (!el || !h) continue;
    const d = document.createElement('details');
    d.className = 'sec-fold'; d.id = `sec-${name}`;
    d.dataset.persist = `hs-sec-${name}`;
    const sm = document.createElement('summary'); sm.textContent = label; d.appendChild(sm);
    el.className = 'sec-body'; // no longer a full page
    d.appendChild(el); h.appendChild(d);
    try { d.open = localStorage.getItem(d.dataset.persist) === '1'; } catch {}
    d.addEventListener('toggle', () => { try { localStorage.setItem(d.dataset.persist, d.open ? '1' : '0'); } catch {} document.dispatchEvent(new CustomEvent('hs-sec', { detail: { name, open: d.open } })); });
  }
  // true while the named moved section is open AND its host page is the one on screen
  window.hsSecOpen = (name) => { const d = $(`#sec-${name}`); return !!d && d.open && HS.view === MOVED[name]; };
  const origShow = window.showView;
  if (typeof origShow === 'function') {
    window.showView = function (name) {
      const host = MOVED[name];
      if (!host) return origShow(name);
      origShow(host);
      const d = $(`#sec-${name}`);
      if (d) {
        d.open = true;
        document.dispatchEvent(new CustomEvent('hs-sec', { detail: { name, open: true } }));
        setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
      }
    };
  }
  const KEY = 'navOrder';
  const navs = () => [...side.querySelectorAll(':scope > .nav')];
  const DEFAULT = navs().map((b) => b.dataset.view); // the order the page shipped with (addons already injected)

  // Put the buttons in the saved order. Views not in the saved list (new features/addons) keep their default place
  // by being slotted in after whichever default neighbour comes before them. The hidden SOFTWARE button is just
  // another button here; it keeps its 'hidden' class so it stays invisible wherever it lands.
  function apply(saved) {
    const known = saved.filter((v) => DEFAULT.includes(v));
    const result = [...known];
    DEFAULT.forEach((v, i) => {
      if (known.includes(v)) return;
      const prev = DEFAULT.slice(0, i).reverse().find((p) => result.includes(p));
      result.splice(prev ? result.indexOf(prev) + 1 : 0, 0, v);
    });
    for (const v of result) side.insertBefore($(`.nav[data-view="${v}"]`), foot);
  }
  const fromFile = () => { const a = hs.uiState?.navOrder; return Array.isArray(a) ? a : null; };
  const fromLs = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(a) ? a : null; } catch { return null; } };
  const store = (arr) => {
    try { if (arr) localStorage.setItem(KEY, JSON.stringify(arr)); else localStorage.removeItem(KEY); } catch {}
    try { hs.uiStateSet?.('navOrder', arr || null); } catch {}
  };
  const save = () => store(navs().map((b) => b.dataset.view));
  const saved = fromFile() || fromLs();
  if (saved) { apply(saved); store(saved.filter((v) => DEFAULT.includes(v))); } // keep both copies in step
  window.hsResetNav = () => { apply(DEFAULT); store(null); };

  let on = false; // (the old REORDER button is gone: dragging always works)
  const setMode = () => {};
  // While reordering, a click on a menu button must not navigate. This runs in the capture phase, ahead of the
  // buttons' own handlers and of tabs.js's Ctrl+click handler (we are loaded first).
  side.addEventListener('click', (e) => { if (on && e.target.closest('.nav')) { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); } }, true);

  // --- drag with pointer events: a green line shows where the button will land ---
  let drag = null, target = null, after = false;
  function clearMarks() { for (const b of navs()) b.classList.remove('drop-before', 'drop-after', 'dragging'); target = null; }
  const visible = () => navs().filter((b) => !b.classList.contains('hidden'));
  // Move `b` before/after `ref` (also used by the tests/keyboard-free callers).
  function move(b, ref, isAfter) { if (b === ref) return; side.insertBefore(b, isAfter ? ref.nextSibling : ref); save(); }
  window.hsMoveNav = (view, refView, isAfter) => move($(`.nav[data-view="${view}"]`), $(`.nav[data-view="${refView}"]`), !!isAfter); // dev/test hook
  window.hsSetReorder = setMode;

  // Press and drag a button any time (no REORDER mode needed): a plain click still navigates, but once the mouse moves
  // more than a few pixels while held, it turns into a drag. In REORDER mode the drag starts immediately.
  let pending = null, swallowClick = false;
  side.addEventListener('pointerdown', (e) => {
    const b = e.button === 0 && e.target.closest('.nav');
    if (!b) return;
    if (on) { drag = b; b.classList.add('dragging'); side.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    pending = { b, x: e.clientX, y: e.clientY };
  });
  side.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); } }, true);
  side.addEventListener('pointermove', (e) => {
    if (pending && !drag) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 6) return;
      drag = pending.b; pending = null; drag.classList.add('dragging'); side.setPointerCapture(e.pointerId); swallowClick = true;
    }
    if (!drag) return;
    const list = visible().filter((b) => b !== drag);
    for (const b of list) b.classList.remove('drop-before', 'drop-after');
    // nearest button by vertical distance to its middle; above the middle = before, below = after
    let best = null, bd = 1e9;
    for (const b of list) { const r = b.getBoundingClientRect(), d = Math.abs(e.clientY - (r.top + r.height / 2)); if (d < bd) { bd = d; best = b; } }
    if (!best) return;
    const r = best.getBoundingClientRect(); target = best; after = e.clientY > r.top + r.height / 2;
    best.classList.add(after ? 'drop-after' : 'drop-before');
  });
  const end = (e, cancel) => {
    pending = null;
    if (!drag) return;
    setTimeout(() => { swallowClick = false; }, 60); // if no click followed the drag, don't eat the next real one
    const d = drag, t = target, a = after; drag = null;
    clearMarks();
    try { side.releasePointerCapture(e.pointerId); } catch {}
    if (!cancel && t) move(d, t, a);
  };
  side.addEventListener('pointerup', (e) => end(e, false));
  side.addEventListener('pointercancel', (e) => end(e, true));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) end({}, true); });
})();
