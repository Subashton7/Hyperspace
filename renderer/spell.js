// SPELL CHECK for the notes editor. Chromium underlines misspelled words in the page box and title (Electron's
// built-in spellchecker); this adds the right-click list of corrections. src/spell.js sends what the spellchecker
// found for the click; we show it in HYPERSPACE's own menu next to Cut / Copy / Paste.
// Picking a correction tells the rabbit (window.twr.mock, if it exists) and fires 'hs-spell-corrected' on window.
(() => {
  if (typeof hs === 'undefined' || hs.remote) return;
  const KEY = 'hs-spell';
  const on = () => localStorage.getItem(KEY) !== 'off';
  const SEL = '#nt-body, #nt-title';
  let last = null;
  hs.on('spell-ctx', (d) => { last = d; });

  const apply = () => document.querySelectorAll(SEL).forEach((el) => { el.spellcheck = on(); el.setAttribute('spellcheck', on() ? 'true' : 'false'); });
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
  apply();
  window.hsSpell = { enabled: on, set(v) { localStorage.setItem(KEY, v ? 'on' : 'off'); apply(); } };

  const waitFor = async (since) => { for (let i = 0; i < 12 && !(last && last.t >= since); i++) await new Promise((r) => setTimeout(r, 25)); return last && last.t >= since ? last : null; };

  document.addEventListener('contextmenu', async (e) => {
    const t = e.target.closest?.(SEL);
    if (!t || !on() || !window.hsMenu) return;
    e.stopImmediatePropagation(); // keep the plain edit menu away; the click still reaches the spellchecker
    const since = Date.now() - 40, ev = { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} };
    last = null;
    const info = await waitFor(since);
    const word = info?.word || '', sel = String(window.getSelection?.() || '') || t.value.slice(t.selectionStart, t.selectionEnd);
    const items = [];
    if (word) {
      for (const s of info.sugg) items.push({ label: s, run: () => fix(t, word, s) });
      if (!info.sugg.length) items.push({ label: '(no suggestions)', off: true, run() {} });
      items.push({ label: `Add "${word}" to dictionary`, run: () => hs.call('spellAdd', word).then(() => { t.blur(); t.focus(); }) }, '-');
    }
    items.push(
      { label: 'Undo', run: () => document.execCommand('undo') },
      '-',
      { label: 'Cut', off: !sel, run: () => document.execCommand('cut') },
      { label: 'Copy', off: !sel, run: () => document.execCommand('copy') },
      { label: 'Paste', run: async () => { try { document.execCommand('insertText', false, await navigator.clipboard.readText()); } catch {} } },
      '-',
      { label: 'Select all', run: () => t.select() },
    );
    t.focus();
    window.hsMenu(ev, items, word ? 'SPELLING' : '');
  }, true);

  async function fix(t, from, to) {
    t.focus();
    await hs.call('spellReplace', to).catch(() => {});
    setTimeout(() => t.dispatchEvent(new Event('input', { bubbles: true })), 30); // so the page notices the new text and saves it
    try { window.twr?.mock?.(from, to); } catch {}
    try { window.dispatchEvent(new CustomEvent('hs-spell-corrected', { detail: { from, to } })); } catch {}
  }
})();
