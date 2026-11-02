// On-screen card for routed files (lives in a small always-on-top window; click reveals the file).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
hs.on('popup', (e) => {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = `<div class="glyph">${esc(e.glyph || '⇶')}</div><div><div class="k">${esc(e.rule)} · ROUTED</div><div class="n">${esc(e.newName)}</div><div class="d">→ ${esc(e.to.replace(/[\\/][^\\/]+$/, ''))}</div></div>`;
  c.addEventListener('click', () => hs.call('routerReveal', e.id));
  document.getElementById('stack').prepend(c);
  setTimeout(() => c.remove(), 5200);
  while (document.querySelectorAll('.card').length > 3) document.querySelector('#stack .card:last-child').remove();
});
