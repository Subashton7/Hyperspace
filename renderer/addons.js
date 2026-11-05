// ADDONS (renderer side): adds each addon's side-menu button, page area, styles and scripts. The list comes from the
// main process (src/addons.js); with no `personal/` folder it is empty and this does nothing. Must load before tabs.js.
(() => {
  const list = hs.addons || [];
  if (!list.length || hs.remote) return;
  const settings = $('.nav[data-view="settings"]'), main = $('main');
  for (const a of list) {
    const host = a.view === 'experts' ? $('#ai-experts') : null; // EXPERTS lives inside the AI tab: no menu button of its own
    if (host) {
      const d = document.createElement('div'); d.id = `view-${a.view}`; d.className = 'ai-embed'; host.appendChild(d);
      for (const c of a.css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = c; document.head.appendChild(l); }
      for (const j of a.js) { const sc = document.createElement('script'); sc.src = j; sc.async = false; document.body.appendChild(sc); }
      continue;
    }
    const b = document.createElement('button');
    b.className = 'nav'; b.dataset.view = a.view; b.title = a.title;
    b.innerHTML = `<svg viewBox="-12 -12 24 24">${a.icon}</svg><span></span>`;
    b.querySelector('span').textContent = a.label;
    b.addEventListener('click', () => showView(a.view));
    settings.before(b);
    const s = document.createElement('section');
    s.className = 'view'; s.id = `view-${a.view}`;
    main.appendChild(s);
    for (const c of a.css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = c; document.head.appendChild(l); }
    for (const j of a.js) { const sc = document.createElement('script'); sc.src = j; sc.async = false; document.body.appendChild(sc); }
  }
})();
