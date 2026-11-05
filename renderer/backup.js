// BACKUP HEALTH: small card on SETTINGS > GENERAL. NOTES copies per mirror, SSD reachable, CRATE backup record, C: free space.
(() => {
  if (hs.remote) return;
  const DAY = 864e5;
  const ago = (t) => { if (!t) return 'never'; const d = Math.floor((Date.now() - t) / DAY); return d < 1 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
  let card = null, busy = false;
  async function draw() {
    if (!card) return;
    let st = null, drives = [];
    try { st = await call('notesState'); } catch {}
    try { drives = await call('notesDrives'); } catch {}
    const mirrors = st?.mirrors || [];
    const last = Math.max(0, ...mirrors.map((m) => m.at || 0));
    const days = last ? (Date.now() - last) / DAY : Infinity;
    const anyHere = mirrors.some((m) => m.here);
    const light = !mirrors.length || days >= 7 ? 'red' : (days >= 2 || !anyHere || mirrors.some((m) => m.ok === false)) ? 'amber' : 'green';
    const col = { green: '#00ff6e', amber: '#ffc400', red: '#ff3b5c' }[light];
    const c = (HS.data.perf?.drives || []).find((d) => /^c/i.test(d.mount || ''));
    const free = c ? `${((c.size - c.used) / 1073741824).toFixed(0)} GB free of ${(c.size / 1073741824).toFixed(0)} GB` : '—';
    let crate = null; try { crate = JSON.parse(localStorage.getItem('hs-crate-last-backup') || 'null'); } catch {}
    const warn = !mirrors.length ? 'No backup copy of your notes is set up yet. Add one in NOTES.' : days >= 7 ? (last ? `Your notes were last copied ${Math.floor(days)} days ago.` : 'Your notes have never been copied to a backup.') : '';
    card.innerHTML = `<div class="panel-head"><span class="glyph" style="color:${col};text-shadow:0 0 8px ${col}">●</span> BACKUP HEALTH</div><div class="set-body">
      <div class="core-rows">
        ${mirrors.map((m) => `<div><span>NOTES copy · ${esc(m.dir)}</span><b style="color:${m.here ? '' : '#ffc400'}">${m.here ? (m.ok === false ? 'FAILED' : ago(m.at)) : 'NOT PLUGGED IN'}</b></div>`).join('') || '<div><span>NOTES copies</span><b>none set up</b></div>'}
        <div><span>SSD / drive mirror</span><b>${anyHere ? 'reachable' : (drives.length ? 'not reachable' : 'no extra drive found')}</b></div>
        <div><span>CRATE backup</span><b>${crate?.at ? ago(crate.at) : 'no record'}</b></div>
        <div><span>C: drive</span><b>${esc(free)}</b></div>
      </div>
      ${warn ? `<div style="color:${col};padding:8px 0">${esc(warn)}</div>` : ''}
      ${crate?.at ? '' : '<div class="dim tiny" style="padding:4px 0">CRATE: no backup recorded yet. In CRATE, back up your rekordbox library to the SSD, then it shows here.</div>'}
      <div class="core-actions" style="padding:8px 0 0"><button class="act" id="bk-now"${busy ? ' disabled' : ''}>${busy ? 'COPYING…' : 'COPY NOW'}</button></div>
    </div>`;
    $('#bk-now').addEventListener('click', async () => {
      busy = true; draw();
      try { await call('notesSyncNow'); toast('NOTES COPIED'); } catch (e) { toast(e.message || 'copy failed', true); }
      busy = false; draw();
    });
  }
  function mount() {
    const host = $('#set-general'); if (!host) return;
    if (!card || !host.contains(card)) { card = document.createElement('div'); card.className = 'panel set-card backup-card'; host.appendChild(card); }
    draw();
  }
  HS.onView((v) => { if (v === 'settings') setTimeout(mount, 250); });
  hs.on('notes-state', () => { if (card && HS.view === 'settings') draw(); });
})();
