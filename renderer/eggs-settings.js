// SETTINGS > SECRETS: every typed easter egg, masked until found. Typing the master word anywhere (abracadabra) reveals the
// full reference popup. Also saves the list as a note ('HYPERSPACE Easter Eggs' in notebook 'Notes').
// Talks to eggs.js only through window.hsEggs and the 'hs-eggs-changed' / 'hs-eggs-reveal' events.
(() => {
  const tabs = document.getElementById('set-tabs');
  if (!tabs || !document.getElementById('view-settings')) return;
  const E = () => window.hsEggs;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const say = (m) => { try { (E() && E().note ? E().note : window.toast)(m); } catch {} };

  const btn = document.createElement('button');
  btn.dataset.st = 'secrets'; btn.textContent = '✦ SECRETS';
  const aboutBtn = tabs.querySelector('[data-st="about"]');
  tabs.insertBefore(btn, aboutBtn || null);
  const page = document.createElement('div');
  page.className = 'set-page hidden'; page.dataset.page = 'secrets'; page.id = 'set-secrets';
  const aboutPage = document.getElementById('set-about');
  if (aboutPage) aboutPage.parentNode.insertBefore(page, aboutPage); else tabs.parentNode.appendChild(page);

  // things the rabbit (rabbit.js / settings.js) handles himself: listed here, never run from here
  const RABBIT = [
    ['follow the white rabbit', 'Type the whole phrase, anywhere.', 'Wakes the White Rabbit and unlocks his tab.'],
    ['Konami code', 'The one every gamer knows. Arrow keys, then two letters.', 'Up, up, down, down, left, right, left, right, B, A: the rabbit shows up.'],
    ['click the title 7 times', 'Lucky number, on the HYPERSPACE title.', 'Seven quick clicks on the title: the rabbit appears.'],
    ['search "rabbit" in FIND', 'Ask the search box about him.', 'Searching for "rabbit" in FIND opens his door.'],
    ['casino', 'Where the chips are play money.', 'Type it, or look at the foot of SETTINGS > GENERAL: blackjack, poker and spades.'],
  ];
  const KIND = { goofy: 'GOOFY', useful: 'USEFUL' };

  function stats(reg) {
    const list = reg.filter((g) => g.kind !== 'secret'), found = list.filter((g) => E().isFound(g.id)).length;
    return { list, found, total: list.length };
  }
  function row(g) {
    const f = E().isFound(g.id), words = g.words.length ? g.words : [];
    const how = g.how ? esc(g.how) : words.map((w) => `<code>${esc(w)}</code>`).join(' ');
    return `<div class="eg-row${f ? ' found' : ''}" data-id="${esc(g.id)}">
      <div class="eg-name">${f ? esc(g.name) : '? ? ? ?'}</div>
      <div class="eg-word">${f ? how : '<code class="mask">????</code>'}</div>
      <div class="eg-hint">${esc(g.hint)}${f ? ` <em>${esc(g.desc)}</em>` : ''}</div>
      <div class="eg-act">${f && words.length ? `<button class="act eg-try" data-try="${esc(g.id)}">TRY IT</button>` : ''}</div></div>`;
  }
  function render() {
    if (!E()) { page.innerHTML = '<div class="panel set-card"><div class="set-body"><p class="dim">Secrets are still loading…</p></div></div>'; return; }
    const reg = E().registry(), s = stats(reg), on = E().isOn(), pct = s.total ? Math.round((s.found / s.total) * 100) : 0;
    const hk = reg.find((g) => g.id === 'hacker');
    const group = (k) => reg.filter((g) => g.kind === k).map(row).join('');
    page.innerHTML = `
      <div class="eg-master ${on ? 'on' : ''}" id="eg-master"><span>TYPED EGGS: <b>${on ? 'ON' : 'OFF'}</b></span><small>${on ? 'Type words anywhere outside text boxes and things happen. Click to switch off.' : 'Typed words are ignored. Click to switch on.'}</small></div>
      <div class="panel set-card eg-wide"><div class="panel-head"><span class="glyph">✦</span> PROGRESS <span class="hint">FOUND ${s.found} / ${s.total}</span></div><div class="set-body">
        <div class="eg-bar"><i style="width:${pct}%"></i></div>
        <p class="dim tiny">Type a word anywhere in HYPERSPACE (not inside a text box, and pause between words). When one works it gets written down here. Each row shows a clue until you find it.</p>
        <p class="eg-clue">the old wizards knew a word that opens every cave…</p>
        <div><button class="act" id="eg-ref">SHOW FULL REFERENCE</button> <button class="act" id="eg-note">SAVE EGG LIST TO MY NOTES</button></div>
      </div></div>
      <div class="panel set-card eg-wide eg-hk"><div class="panel-head"><span class="glyph">⌨</span> HACKER TERMINAL <span class="hint">always on</span></div><div class="set-body">
        <p><b>Hold Ctrl and press 6 and 7.</b> Works anywhere. Mash any keys to stream fake code; Esc or the same chord leaves.</p>
        <button class="act" id="eg-hk">OPEN IT NOW</button>
      </div></div>
      <div class="panel set-card eg-wide"><div class="panel-head"><span class="glyph">☺</span> GOOFY <span class="hint">useless and fun</span></div><div class="set-body eg-list">${group('goofy')}</div></div>
      <div class="panel set-card eg-wide"><div class="panel-head"><span class="glyph">⚙</span> USEFUL <span class="hint">small tools you will actually use</span></div><div class="set-body eg-list">${group('useful')}</div></div>
      <div class="panel set-card eg-wide"><div class="panel-head"><span class="glyph">•</span> OTHER HIDDEN THINGS</div><div class="set-body eg-list">${reg.filter((g) => g.kind === 'other' && g.id !== 'hacker').map(row).join('')}</div></div>
      <div class="panel set-card eg-wide"><div class="panel-head"><span class="glyph">\u{1F407}</span> THE WHITE RABBIT’S FINDERS <span class="hint">handled by the rabbit</span></div><div class="set-body eg-list">${RABBIT.map((r) => `<div class="eg-row found"><div class="eg-name">${esc(r[0])}</div><div class="eg-word"></div><div class="eg-hint">${esc(r[1])} <em>${esc(r[2])}</em></div><div class="eg-act"></div></div>`).join('')}</div></div>`;
  }

  page.addEventListener('click', (e) => {
    const t = e.target;
    if (!E()) return;
    if (t.closest('#eg-master')) { E().setOn(!E().isOn()); return render(); }
    if (t.closest('#eg-ref')) return reveal(false);
    if (t.closest('#eg-note')) return saveNote();
    if (t.closest('#eg-hk')) { E().run('hacker'); return; }
    const tr = t.closest('[data-try]'); if (tr) { E().run(tr.dataset.try); }
  });
  tabs.addEventListener('click', (e) => { if (e.target.closest('[data-st="secrets"]')) render(); });
  document.addEventListener('hs-eggs-changed', () => { if (!page.classList.contains('hidden')) render(); });

  // ---------- full reference popup ----------
  let pop = null;
  function listMD() {
    const reg = E().registry(), tbl = (k) => `| WORD | WHAT IT DOES | HINT |\n| --- | --- | --- |\n` + reg.filter((g) => g.kind === k).map((g) => `| ${g.words.map((w) => '`' + w + '`').join(' / ')} | ${g.name}: ${g.desc} | ${g.hint} |`).join('\n');
    return `# HYPERSPACE Easter Eggs\n\nType these words anywhere in HYPERSPACE (not inside a text box; pause between words). The master word that shows this list is **abracadabra**.\n\n## Hacker terminal\n\nHold **Ctrl** and press **6** and **7**. Mash any keys; Esc leaves.\n\n## Goofy\n\n${tbl('goofy')}\n\n## Useful\n\n${tbl('useful')}\n\n## Other hidden things\n\n${reg.filter((g) => g.kind === 'other').map((g) => `- **${g.name}**: ${g.how}. ${g.desc}`).join('\n')}\n\n## White Rabbit finders\n\n${RABBIT.map((r) => `- **${r[0]}**: ${r[2]}`).join('\n')}\n\n*Panic tip: hold Esc for 2 seconds for the boss screen; Esc twice returns.*\n`;
  }
  function reveal(auto) {
    if (!E()) return;
    if (auto) E().markAll();
    if (pop) { pop.remove(); pop = null; }
    const reg = E().registry();
    const grp = (k, label) => `<h4>${label}</h4><div class="egr-grid">${reg.filter((g) => g.kind === k).map((g) => `<div><code>${esc(g.words.join(' / '))}</code><span>${esc(g.name)}</span></div>`).join('')}</div>`;
    pop = document.createElement('div'); pop.className = 'egr-back';
    pop.innerHTML = `<div class="egr-box" role="dialog" aria-label="Easter egg words"><div class="egr-h"><b>✦ ALL THE WORDS</b><button class="egr-x" aria-label="Close">&times;</button></div><div class="egr-b">
      <p class="egr-hk">Hacker terminal: hold <b>Ctrl</b>, press <b>6</b> and <b>7</b></p>
      ${grp('goofy', 'GOOFY')}${grp('useful', 'USEFUL')}
      <h4>OTHER</h4><div class="egr-grid">${reg.filter((g) => g.kind === 'other' && g.id !== 'hacker').map((g) => `<div><code>${esc(g.how)}</code><span>${esc(g.name)}</span></div>`).join('')}${RABBIT.map((r) => `<div><code>${esc(r[0])}</code><span>rabbit</span></div>`).join('')}<div><code>hold Esc 2s</code><span>panic screen</span></div></div>
      </div><div class="egr-f"><button class="act" data-n>SAVE EGG LIST TO MY NOTES</button><button class="act" data-c>CLOSE</button></div></div>`;
    document.body.appendChild(pop);
    const close = () => { if (pop) { pop.remove(); pop = null; } window.removeEventListener('keydown', k, true); };
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', k, true);
    pop.addEventListener('click', (e) => { if (e.target === pop || e.target.closest('.egr-x') || e.target.closest('[data-c]')) close(); if (e.target.closest('[data-n]')) saveNote(); });
    if (auto && !E().flag('noteOffered')) { E().flag('noteOffered', true); setTimeout(() => say('Tip: SAVE EGG LIST TO MY NOTES keeps this list in your NOTES.'), 900); }
  }
  document.addEventListener('hs-eggs-reveal', () => reveal(true));

  // ---------- save to notes ----------
  const TITLE = 'HYPERSPACE Easter Eggs';
  async function saveNote() {
    try {
      const call = window.hs && hs.call; if (!call) return say('Notes are not available here.');
      let state = null; try { state = await hs.call('notesState'); } catch {}
      if (state && state.exists === false) return say('Open NOTES first to set it up, then try again.');
      const list = (await hs.call('notesList')) || [];
      const old = list.find((n) => n && n.title === TITLE && n.notebook === 'Notes' && !n.deleted && !n.journal);
      const body = listMD();
      if (old) { const full = await hs.call('notesGet', old.id); await hs.call('notesSave', { ...(full || old), id: old.id, title: TITLE, notebook: 'Notes', body }); say('Updated "HYPERSPACE Easter Eggs" in your NOTES.'); }
      else { await hs.call('notesSave', { title: TITLE, notebook: 'Notes', body }); say('Saved "HYPERSPACE Easter Eggs" to NOTES > Notes.'); }
    } catch (err) {
      const m = String((err && err.message) || err);
      say(/lock/i.test(m) ? 'NOTES is locked: open NOTES and unlock it first.' : 'Could not save to NOTES: open NOTES first, then try again.');
    }
  }

  // ---------- subtle hint inside ABOUT ----------
  const about = document.getElementById('set-about');
  function aboutHint() {
    if (!about || about.querySelector('.eg-aboutnote')) return;
    const body = about.querySelector('.set-body'); if (!body) return;
    const p = document.createElement('p'); p.className = 'dim tiny eg-aboutnote';
    p.innerHTML = 'Psst: there are hidden things. Hold <b>Ctrl</b> and press <b>6</b> and <b>7</b>. More in SETTINGS &gt; SECRETS.';
    body.appendChild(p);
  }
  if (about) { new MutationObserver(aboutHint).observe(about, { childList: true }); aboutHint(); }

  try { if (localStorage.getItem('settingsTab') === 'secrets') setTimeout(() => btn.click(), 700); } catch {}
  render();
})();
