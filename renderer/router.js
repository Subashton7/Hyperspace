// ROUTER page: watch folders, edit sorting rules, see (and undo) everything that was routed.
(() => {
  let s = null;
  const fmtAgo = (t) => { const d = (Date.now() - t) / 1000; return d < 60 ? 'just now' : d < 3600 ? `${Math.floor(d / 60)}m ago` : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

  async function load() {
    try { render(await call('routerGet')); } catch (e) { $('#rt-state').textContent = e.message; }
  }
  async function save(patch) {
    try { render(await call('routerSet', patch)); } catch (e) { toast(e.message, true); }
  }

  function render(next) {
    s = next;
    HS.data.router = { enabled: s.cfg.enabled, log: s.log };
    $('#rt-enabled').checked = s.cfg.enabled;
    $('#rt-clean').checked = s.cfg.clean;
    $('#rt-popup').checked = s.cfg.popup;
    $('#rt-state').innerHTML = s.cfg.enabled
      ? `<b class="on">● WATCHING ${s.watching} FOLDER${s.watching === 1 ? '' : 'S'}</b> · new files that match a rule move automatically`
      : '<b>○ OFF</b> · flip the switch to start routing new downloads';
    $('#rt-watch').innerHTML = s.cfg.watch.map((d, i) => `<div class="rt-folder"><span title="${esc(d)}">${esc(d)}</span><button data-rmw="${i}" title="Stop watching">✕</button></div>`).join('') || '<div class="dim">no folders</div>';
    $('#rt-rulelist').innerHTML = s.cfg.rules.map((r, i) => `<div class="rt-rule${r.enabled ? '' : ' off'}" data-i="${i}">
      <div class="rt-rhead"><span class="rt-glyph">${esc(r.glyph || '⇶')}</span><input class="rt-name" value="${esc(r.name)}" spellcheck="false" />
        <label class="switch"><input type="checkbox" class="rt-on" ${r.enabled ? 'checked' : ''} /><span></span></label><button class="rt-del" title="Delete rule">✕</button></div>
      <label>FILE TYPES</label><input class="rt-exts" value="${esc(r.exts.join(', '))}" spellcheck="false" />
      <label>MOVE TO</label><div class="rt-dest"><input class="rt-destin" value="${esc(r.dest)}" spellcheck="false" />${hs.remote ? '' : '<button class="chip mini rt-pick">CHOOSE…</button>'}</div>
      <label>RENAME TO <em>{name} {date} {time} {rule}</em></label><input class="rt-ren" value="${esc(r.rename || '{name}')}" spellcheck="false" />
    </div>`).join('');
    $('#rt-loglist').innerHTML = s.log.length ? s.log.map((e) => `<div class="rt-entry${e.undone ? ' undone' : ''}">
      <span class="rt-glyph">${esc(e.glyph || '⇶')}</span>
      <div><b>${esc(e.newName)}</b><span>${esc(e.rule)} · ${esc(e.to.replace(/[\\/][^\\/]+$/, ''))}</span>${e.oldName !== e.newName ? `<span class="dim">was ${esc(e.oldName)}</span>` : ''}</div>
      <em>${fmtAgo(e.time)}</em>
      <div class="rt-acts">${e.undone ? '<span class="dim">undone</span>' : `<button data-reveal="${e.id}">SHOW</button><button data-undo="${e.id}">UNDO</button>`}</div>
    </div>`).join('') : '<div class="dim rt-empty">Nothing routed yet. Turn the router on, then download a .wav, .mp4, .svg or .glb to see it fly.</div>';
  }

  // rule edits
  function rulesFromDom() {
    return [...$$('#rt-rulelist .rt-rule')].map((el) => {
      const r = s.cfg.rules[+el.dataset.i];
      return {
        ...r,
        name: el.querySelector('.rt-name').value.trim() || r.name,
        enabled: el.querySelector('.rt-on').checked,
        exts: el.querySelector('.rt-exts').value.split(/[\s,;]+/).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean),
        dest: el.querySelector('.rt-destin').value.trim() || r.dest,
        rename: el.querySelector('.rt-ren').value.trim() || '{name}',
      };
    });
  }
  $('#rt-rulelist').addEventListener('change', () => save({ rules: rulesFromDom() }));
  $('#rt-rulelist').addEventListener('click', async (e) => {
    const el = e.target.closest('.rt-rule');
    if (!el) return;
    if (e.target.classList.contains('rt-del')) {
      if (!confirm('Delete this sorting rule? Files already sorted stay where they are.')) return;
      const rules = rulesFromDom();
      rules.splice(+el.dataset.i, 1);
      return save({ rules });
    }
    if (e.target.classList.contains('rt-pick')) {
      const dir = await call('routerPickFolder', 'Where should these files go?');
      if (dir) { el.querySelector('.rt-destin').value = dir; save({ rules: rulesFromDom() }); }
    }
  });
  $('#rt-addrule').addEventListener('click', () => save({
    rules: [...rulesFromDom(), { id: `r${Date.now().toString(36)}`, name: 'NEW RULE', glyph: '⇶', exts: ['zip'], dest: `${s.base}\\Other`, rename: '{name}', enabled: false }],
  }));

  // folders + switches
  $('#rt-enabled').addEventListener('change', (e) => { save({ enabled: e.target.checked }); toast(e.target.checked ? 'ASSET ROUTER ON · WATCHING FOR NEW FILES' : 'ASSET ROUTER OFF'); });
  $('#rt-clean').addEventListener('change', (e) => save({ clean: e.target.checked }));
  $('#rt-popup').addEventListener('change', (e) => save({ popup: e.target.checked }));
  $('#rt-addwatch').addEventListener('click', async () => {
    const dir = await call('routerPickFolder', 'Watch which folder?');
    if (dir && !s.cfg.watch.includes(dir)) save({ watch: [...s.cfg.watch, dir] });
  });
  if (hs.remote) $('#rt-addwatch').classList.add('hidden');
  $('#rt-watch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rmw]');
    if (b) save({ watch: s.cfg.watch.filter((_, i) => i !== +b.dataset.rmw) });
  });
  let armRun = false;
  $('#rt-runnow').addEventListener('click', async () => {
    if (!armRun) { armRun = true; $('#rt-runnow').textContent = 'SURE? MOVES EXISTING FILES'; setTimeout(() => { armRun = false; $('#rt-runnow').textContent = "SORT WHAT'S THERE NOW"; }, 3000); return; }
    armRun = false;
    $('#rt-runnow').textContent = "SORT WHAT'S THERE NOW";
    try { const done = await call('routerRunNow'); toast(`ROUTED ${done.length} FILE${done.length === 1 ? '' : 'S'}`); load(); }
    catch (e) { toast(e.message, true); }
  });
  $('#rt-test').addEventListener('input', async (e) => {
    const v = e.target.value.trim();
    if (!v) { $('#rt-testout').textContent = ''; return; }
    const r = await call('routerTest', v);
    $('#rt-testout').textContent = r.rule ? `→ ${r.rule}: ${r.dest}\\${r.newName}` : 'no enabled rule matches that file type';
  });

  // activity
  $('#rt-loglist').addEventListener('click', async (e) => {
    const u = e.target.closest('[data-undo]'), r = e.target.closest('[data-reveal]');
    try {
      if (u) { await call('routerUndo', u.dataset.undo); toast('MOVED BACK'); load(); }
      if (r) await call('routerReveal', r.dataset.reveal);
    } catch (er) { toast(er.message, true); }
  });

  hs.on('routed', (e) => { toast(`${e.glyph || '⇶'} ${e.rule} · ${e.newName}`); load(); });
  hs.on('router', () => { if (HS.view === 'router') load(); });
  hs.on('router-error', (m) => toast(`ROUTER: ${m}`, true));
  HS.onView((v) => { if (v === 'router') load(); });
  load();
})();
