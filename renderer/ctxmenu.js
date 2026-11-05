// RIGHT-CLICK MENUS: one small helper every page uses (window.hsMenu), plus menus for things that had none:
// the sidebar buttons and every text box (undo / cut / copy / paste / select all). Menus close on click elsewhere,
// Esc, scroll or window blur. Skipped on the phone remote.
(() => {
  if (hs.remote) return;
  let el = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function close() { el?.remove(); el = null; }
  // items: [{ label, run, danger, off }] or '-' for a divider. Returns false if there is nothing to show.
  function menu(e, items, title = '') {
    close();
    items = items.filter((x, i, a) => x && !(x === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)));
    if (!items.length) return false;
    e.preventDefault(); e.stopPropagation();
    el = document.createElement('div');
    el.className = 'ctx-menu';
    el.innerHTML = (title ? `<div class="cm-head">${esc(title)}</div>` : '') + items.map((x, i) => (x === '-' ? '<hr>' : `<button data-i="${i}" class="${x.danger ? 'danger' : ''}" ${x.off ? 'disabled' : ''}>${esc(x.label)}</button>`)).join('');
    document.body.appendChild(el);
    el.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - el.offsetWidth - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(e.clientY, innerHeight - el.offsetHeight - 6))}px`;
    el.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-i]'); if (!b || b.disabled) return; const it = items[+b.dataset.i]; close(); try { it.run(); } catch (er) { console.error(er); } });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return true;
  }
  window.hsMenu = menu;
  document.addEventListener('mousedown', (e) => { if (el && !el.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  document.addEventListener('scroll', close, true);
  window.addEventListener('blur', close);

  // text boxes: the standard edit menu (a page can show its own menu first; this only fills in when nobody did)
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    const t = e.target.closest?.('input, textarea, [contenteditable="true"]');
    if (!t || (t.tagName === 'INPUT' && !/^(text|search|url|email|tel|password|number)$/i.test(t.type))) return;
    const sel = String(window.getSelection?.() || '') || (t.value != null ? t.value.slice(t.selectionStart, t.selectionEnd) : '');
    const ro = t.readOnly || t.disabled, pw = t.type === 'password';
    t.focus();
    menu(e, [
      { label: 'Undo', off: ro, run: () => document.execCommand('undo') },
      { label: 'Redo', off: ro, run: () => document.execCommand('redo') },
      '-',
      { label: 'Cut', off: ro || pw || !sel, run: () => document.execCommand('cut') },
      { label: 'Copy', off: pw || !sel, run: () => document.execCommand('copy') },
      { label: 'Paste', off: ro, run: async () => { try { document.execCommand('insertText', false, await navigator.clipboard.readText()); } catch {} } },
      '-',
      { label: 'Select all', run: () => (t.select ? t.select() : document.execCommand('selectAll')) },
    ]);
  });

  // the sidebar buttons: open, move around, reset
  document.addEventListener('contextmenu', (e) => {
    const b = e.target.closest?.('.side > .nav');
    if (!b || e.defaultPrevented) return;
    const side = b.parentElement, navs = [...side.querySelectorAll(':scope > .nav:not(.hidden)')], i = navs.indexOf(b);
    const to = (ref, after) => window.hsMoveNav?.(b.dataset.view, ref.dataset.view, after);
    const name = b.querySelector('span')?.textContent || b.dataset.view;
    menu(e, [
      { label: `Open ${name}`, run: () => b.click() },
      { label: 'Open in a new tab', run: () => b.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })) },
      '-',
      { label: 'Move to the top', off: i <= 0, run: () => to(navs[0], false) },
      { label: 'Move up', off: i <= 0, run: () => to(navs[i - 1], false) },
      { label: 'Move down', off: i >= navs.length - 1, run: () => to(navs[i + 1], true) },
      { label: 'Move to the bottom', off: i >= navs.length - 1, run: () => to(navs[navs.length - 1], true) },
      '-',
      { label: 'Reset menu order', run: () => { try { localStorage.removeItem('navOrder'); } catch {} try { window.hsResetNav ? window.hsResetNav() : hs.uiStateSet?.('navOrder', null); } catch {} location.reload(); } },
    ], name);
  });
})();
