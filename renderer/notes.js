// NOTES: the encrypted notebook + journal that replaces OneNote. Everything is decrypted in the laptop's main
// process only while unlocked; this page asks for one note at a time. See src/notes.js for the vault itself.
(() => {
  const root = $('#view-notes');
  if (!root || hs.remote) { if (root) root.innerHTML = '<div class="nt-center"><p>NOTES only opens on the laptop itself.</p></div>'; return; }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = { state: null, list: [], book: 'all', section: null, q: '', hits: null, cur: null, dirty: false, blobs: new Map() };
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

  // ---------------- Markdown → HTML (escaped first, so a note can never run code) ----------------
  function inline(s) {
    return esc(s)
      .replace(/!\[([^\]]*)\]\(hs-blob:([0-9a-f]{24})\)/g, '<img class="nt-img" data-blob="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(hs-blob:([0-9a-f]{24})\)/g, (_, name, bid) => `<span class="nt-file" data-blob="${bid}" data-name="${name}"><i>${fileKind(name)}</i><b>${name}</b><button data-fact="open">OPEN</button><button data-fact="save">SAVE A COPY</button></span>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>');
  }
  const fileKind = (name) => { const x = (String(name).match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toUpperCase(); return x || (/pdf/i.test(name) ? 'PDF' : 'FILE'); };
  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre>${esc(buf.join('\n'))}</pre>`); continue; }
      if (/^#{1,4}\s/.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n + 1}>${inline(l.replace(/^#+\s*/, ''))}</h${n + 1}>`); i++; continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\|.*\|\s*$/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')))); i++; }
        out.push(`<table>${rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`);
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
          const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s(\[[ xX]\]\s)?(.*)$/);
          items.push({ depth: Math.floor(m[1].length / 2), box: m[3] ? (/x/i.test(m[3]) ? 'x' : ' ') : null, text: m[4], line: i });
          i++;
        }
        out.push(`<ul class="nt-ul">${items.map((it) => `<li style="margin-left:${it.depth * 18}px">${it.box ? `<input type="checkbox" data-line="${it.line}" ${it.box === 'x' ? 'checked' : ''}>` : ''}${inline(it.text)}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`); continue; }
      if (!l.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s|>)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }
  async function fillBlobs(el) {
    for (const img of el.querySelectorAll('img[data-blob]')) {
      const id = img.dataset.blob;
      if (!S.blobs.has(id)) S.blobs.set(id, call('notesBlob', id).catch(() => ''));
      img.src = await S.blobs.get(id);
    }
  }

  // ---------------- screens ----------------
  async function refresh() {
    S.state = await call('notesState');
    if (!S.state.exists) return setup();
    if (!S.state.open) return lockScreen();
    if (!root.querySelector('.nt-app')) shell();
    await loadList();
    copies(); lockButton();
  }

  function setup(step = 1, data = {}) {
    if (step === 1) {
      root.innerHTML = `<div class="nt-center"><div class="nt-card">
        <div class="nt-kicker">NOTES · STEP 1 OF 3</div><h2>Make your master password</h2>
        <p>Your journal is locked with this password, on this computer and on any backup drive you add. Everyday notes open without it. Pick something long you'll remember: a sentence works well.</p>
        <input type="password" id="nt-p1" placeholder="master password (10+ characters)" autocomplete="new-password">
        <input type="password" id="nt-p2" placeholder="type it again" autocomplete="new-password">
        <div class="nt-meter"><i id="nt-meter"></i></div><p class="dim" id="nt-meter-t">&nbsp;</p>
        <button class="nt-go" id="nt-next">NEXT ›</button></div></div>`;
      const meter = () => {
        const p = $('#nt-p1').value, kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/, /\s/].filter((r) => r.test(p)).length;
        const score = Math.min(100, p.length * 4 + kinds * 8);
        $('#nt-meter').style.width = `${score}%`;
        $('#nt-meter').style.background = score < 50 ? 'var(--red)' : score < 75 ? 'var(--amber)' : 'var(--g)';
        $('#nt-meter-t').textContent = !p ? ' ' : p.length < 10 ? `${10 - p.length} more characters` : score < 75 ? 'okay: longer is stronger' : 'strong';
      };
      $('#nt-p1').addEventListener('input', meter);
      $('#nt-next').addEventListener('click', () => {
        const a = $('#nt-p1').value, b = $('#nt-p2').value;
        if (a.length < 10) return toast('USE AT LEAST 10 CHARACTERS', true);
        if (a !== b) return toast("THE TWO PASSWORDS DON'T MATCH", true);
        setup(2, { pw: a });
      });
      $('#nt-p1').focus();
    } else if (step === 2) {
      root.innerHTML = `<div class="nt-center"><div class="nt-card">
        <div class="nt-kicker">NOTES · STEP 2 OF 3</div><h2>Where should the copies go?</h2>
        <p>The main copy lives on this laptop (Documents\\HYPERSPACE Notes). Tick where the extra copies go: they update by themselves every few minutes and whenever the drive is plugged in. Everything in them is encrypted.</p>
        <div id="nt-drives" class="nt-drives">checking drives…</div>
        <p class="dim">Your home server can be added later, from the vault settings.</p>
        <button class="nt-go" id="nt-create">CREATE MY NOTES ›</button></div></div>`;
      call('notesDrives').then((d) => {
        $('#nt-drives').innerHTML = d.length ? d.map((x) => `<label><input type="checkbox" value="${esc(x.suggest)}" checked> ${esc(x.root)} ${x.label ? `<b>${esc(x.label)}</b>` : ''} <span class="dim">→ ${esc(x.suggest)}</span></label>`).join('') : '<p class="dim">No other drive is plugged in right now. Plug in the SSD and you can add it from the vault settings.</p>';
      });
      $('#nt-create').addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = 'LOCKING IT DOWN…';
        try {
          const mirrors = $$('#nt-drives input:checked').map((x) => x.value);
          const r = await call('notesCreate', data.pw, mirrors);
          setup(3, { recovery: r.recovery });
        } catch (er) { toast(er.message, true); e.target.disabled = false; e.target.textContent = 'CREATE MY NOTES ›'; }
      });
    } else {
      root.innerHTML = `<div class="nt-center"><div class="nt-card">
        <div class="nt-kicker">NOTES · STEP 3 OF 3</div><h2>Your recovery key</h2>
        <p>If you ever forget your password, this key is the only other way in. Nobody, not even HYPERSPACE, can reset it. <b>Write it on paper</b> and keep it somewhere safe, away from this laptop.</p>
        <div class="nt-recovery">${esc(data.recovery)}</div>
        <button class="nt-go ghost" id="nt-copy">COPY IT</button>
        <label class="nt-tick"><input type="checkbox" id="nt-saved"> I've written it down somewhere safe</label>
        <button class="nt-go" id="nt-done" disabled>OPEN MY NOTES ›</button></div></div>`;
      $('#nt-copy').addEventListener('click', () => { navigator.clipboard.writeText(data.recovery); toast('COPIED · PASTE IT SOMEWHERE SAFE, THEN CLEAR IT'); });
      $('#nt-saved').addEventListener('change', (e) => { $('#nt-done').disabled = !e.target.checked; });
      $('#nt-done').addEventListener('click', () => { data.recovery = null; refresh(); });
    }
  }

  // Only shown once per laptop (or for a vault from before 0.10.7): after this, everyday notes open by
  // themselves and only the journal asks for the password.
  function lockScreen() {
    root.innerHTML = `<div class="nt-center"><div class="nt-card">
      <div class="nt-kicker">🔒 NOTES · ENCRYPTED</div><h2>Type your password once</h2>
      <p class="dim">After this, your notes open by themselves on this laptop. Only the <b>journal</b> asks for the password.</p>
      <div id="nt-unl" class="nt-unl"></div></div></div>`;
    unlockForm($('#nt-unl'), () => { S.cur = null; root.innerHTML = ''; refresh(); });
  }
  // password box + recovery-key link; onDone runs once it worked
  function unlockForm(el, onDone, label = 'UNLOCK') {
    el.innerHTML = `<input type="password" class="nt-pw" placeholder="master password" autocomplete="current-password">
      <button class="nt-go nt-open">${label}</button>
      <p class="dim"><a href="#" class="nt-rec">Forgot it? Use your recovery key</a></p>`;
    const pw = el.querySelector('.nt-pw'), btn = el.querySelector('.nt-open');
    let rec = false;
    const go = async () => {
      const v = pw.value;
      if (!v) return;
      btn.disabled = true; btn.textContent = 'UNLOCKING…';
      try { await call('notesUnlock', v, rec); onDone(); }
      catch (e) {
        const msg = /wrong/i.test(e.message) ? (rec ? "That recovery key didn't work. Check every group of letters." : "That password didn't work. Check Caps Lock, or use your recovery key.") : e.message;
        let err = el.querySelector('.nt-err'); if (!err) { err = document.createElement('p'); err.className = 'nt-err'; btn.after(err); }
        err.textContent = msg; btn.disabled = false; btn.textContent = label; pw.select();
      }
    };
    btn.addEventListener('click', go);
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    el.querySelector('.nt-rec').addEventListener('click', (e) => { e.preventDefault(); rec = true; pw.type = 'text'; pw.placeholder = 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'; pw.value = ''; pw.focus(); e.target.parentElement.textContent = 'Type your recovery key. Afterwards, set a new password in the vault settings.'; });
    setTimeout(() => pw.focus(), 50);
  }
  // the journal is locked: ask for the password in the middle of the page, then carry on
  function journalPrompt(then) {
    S.cur = null;
    $('#nt-edit').innerHTML = `<div class="nt-center"><div class="nt-card">
      <div class="nt-kicker">🔒 JOURNAL</div><h2>Your journal is locked</h2>
      ${S.state.lockedJournal ? `<p class="dim">${S.state.lockedJournal} journal ${S.state.lockedJournal === 1 ? 'page is' : 'pages are'} hidden until you unlock it.</p>` : ''}
      ${S.state.why ? `<p class="dim">Locked because ${esc(S.state.why)}.</p>` : ''}
      <div id="nt-junl" class="nt-unl"></div></div></div>`;
    unlockForm($('#nt-junl'), async () => { await loadList(); if (then) then(); else { $('#nt-edit').innerHTML = '<div class="nt-empty">Journal unlocked. Pick an entry, or start a new one.</div>'; } }, 'UNLOCK JOURNAL');
  }
  function lockButton() {
    const b = $('#nt-lock');
    if (b) b.textContent = S.state?.unlocked ? '🔒 LOCK JOURNAL' : '🔓 UNLOCK JOURNAL';
    const c = $('#nt-jchip');
    if (c) c.textContent = S.state?.unlocked ? 'JOURNAL OPEN' : 'JOURNAL LOCKED';
  }

  // ---------------- the screen ----------------
  // One sidebar on the left (notebooks, then the pages inside the one you picked, with search / filter / sort) and
  // the whole rest of the window is the page you're writing. There is no READ / EDIT switch: a page is always a
  // text box you can type in, with the finished look (pictures, files, ticking to-dos) beside it.
  const pref = {
    get() { try { return JSON.parse(localStorage.getItem('hs-notes-view') || '{}'); } catch { return {}; } },
    set(p) { try { localStorage.setItem('hs-notes-view', JSON.stringify({ ...pref.get(), ...p })); } catch {} },
  };
  const SORTS = [['edited-new', 'EDITED · NEWEST'], ['edited-old', 'EDITED · OLDEST'], ['created-new', 'CREATED · NEWEST'], ['created-old', 'CREATED · OLDEST'], ['title-az', 'TITLE · A → Z'], ['title-za', 'TITLE · Z → A']];
  const FILTERS = [['all', 'ALL PAGES'], ['files', 'PICTURES / FILES'], ['todos', 'OPEN TO-DOS'], ['today', 'EDITED TODAY'], ['week', 'EDITED THIS WEEK']];
  Object.assign(S, { sort: 'edited-new', filter: 'all', preview: true, adding: null, fresh: null, tok: 0 }, (() => { const v = pref.get(); return { sort: SORTS.some((x) => x[0] === v.sort) ? v.sort : 'edited-new', filter: FILTERS.some((x) => x[0] === v.filter) ? v.filter : 'all', preview: v.preview !== false }; })());

  function shell() {
    root.innerHTML = `<div class="nt-app">
      <div class="nt-top">
        <span class="nt-lockchip">🔒 ENCRYPTED</span><span class="nt-lockchip" id="nt-jchip"></span><span id="nt-copies" class="nt-copies"></span>
        <span class="grow"></span>
        <span class="nt-accl">ACCENT</span><div class="acc-row" id="nt-acc"></div>
        <button class="act" id="nt-journal">✎ JOURNAL ENTRY</button>
        <button class="act" id="nt-import">⇩ IMPORT ONENOTE</button><button class="act" id="nt-vault">⚙ VAULT</button><button class="act" id="nt-lock">🔒 LOCK JOURNAL</button>
      </div>
      <div class="nt-import hidden" id="nt-imp"></div>
      <div class="nt-cols">
        <div class="nt-side">
          <div class="nt-newrow"><button class="nt-addpage" id="nt-addpage">+ NEW PAGE</button><button class="nt-addbook" id="nt-addbook">+ NEW NOTEBOOK</button></div>
          <div class="nt-books" id="nt-books"></div>
          <div class="nt-phead">
            <div class="nt-where" id="nt-where"></div>
            <input type="search" id="nt-q" placeholder="search every note…">
            <div class="nt-fs"><select id="nt-filter" title="Show only some pages">${FILTERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select id="nt-sort" title="Order of the pages">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          </div>
          <div class="nt-list" id="nt-list"></div>
        </div>
        <div class="nt-edit" id="nt-edit"></div>
      </div></div>`;
    $('#nt-filter').value = S.filter; $('#nt-sort').value = S.sort;
    $('#nt-addpage').addEventListener('click', () => newNote());
    $('#nt-addbook').addEventListener('click', async () => { await flush(); S.adding = 'book'; renderBooks(); $('#nt-books').scrollTop = 0; });
    $('#nt-journal').addEventListener('click', () => newJournal());
    $('#nt-lock').addEventListener('click', async () => {
      if (!S.state.unlocked) { S.book = 'journal'; S.section = null; renderBooks(); renderList(); return journalPrompt(); }
      await flush(); call('notesLock');
    });
    $('#nt-import').addEventListener('click', () => (S.state.unlocked ? importOneNote() : journalPrompt(importOneNote)));
    $('#nt-vault').addEventListener('click', vaultSettings);
    $('#nt-filter').addEventListener('change', (e) => { S.filter = e.target.value; pref.set({ filter: S.filter }); renderList(); });
    $('#nt-sort').addEventListener('change', (e) => { S.sort = e.target.value; pref.set({ sort: S.sort }); renderList(); });
    window.drawAccentRow?.($('#nt-acc'));
    // files from Explorer: onto the open page = attach them; onto the sidebar = a new page holding them
    const hasFiles = (e) => e.dataTransfer.types.includes('Files');
    const dropTarget = (el, ok, onDrop) => {
      el.addEventListener('dragover', (e) => { if (hasFiles(e) && ok()) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
      el.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); el.classList.remove('drop'); if (ok()) onDrop([...e.dataTransfer.files]); });
    };
    dropTarget($('#nt-edit'), () => S.cur && !S.cur.deleted, addFiles);
    dropTarget($('.nt-side'), () => S.book !== 'trash', async (files) => {
      const f = files[0]; if (!f) return;
      await newNote({ title: f.name.replace(/\.[^.]+$/, '') });
      await addFiles(files);
    });
    let qt;
    $('#nt-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(async () => { S.q = e.target.value.trim(); S.hits = S.q ? new Set(await call('notesSearch', S.q)) : null; renderList(); }, 200); });
    renderEditor();
  }

  async function loadList() {
    S.list = await call('notesList'); renderBooks(); renderList();
    if (!S.list.length && !S.offered) {
      S.offered = true;
      const guess = await call('notesExportFolderGuess').catch(() => null);
      if (guess) { $('#nt-imp').classList.remove('hidden'); $('#nt-imp').innerHTML = '<b>YOUR ONENOTE EXPORT IS HERE</b> Documents\\OneNote Notes has your exported notebooks ready to bring in. <button class="act" id="nt-imp-go">IMPORT IT NOW</button>'; $('#nt-imp-go').addEventListener('click', importOneNote); }
    }
  }

  const PALETTE = ['#00ff6e', '#1de9b6', '#c6ff00', '#ffc400', '#ff8a65', '#ff4fd8', '#8ab4ff', '#b388ff'];
  function color(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  // what the sidebar shows for a page (the vault's own list() makes the same thing for pages it loads)
  const previewOf = (body) => (body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\(hs-blob:[^)]*\)/g, '📎 $1').replace(/[#*>`~_\[\]()|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  const metaOf = (n) => ({ id: n.id, title: n.title, notebook: n.notebook, section: n.section, created: n.created, updated: n.updated, journal: !!n.journal, deleted: !!n.deleted, preview: previewOf(n.body), pics: (n.blobs || []).length, todos: (String(n.body || '').match(/^\s*([-*]|\d+\.)\s\[ \]/gm) || []).length });

  // the notebook tree: the open notebook shows its sections underneath it; pages can be dragged onto any row
  function renderBooks() {
    const live = S.list.filter((n) => !n.deleted);
    const books = {};
    for (const n of live) { const b = (books[n.notebook || 'Notes'] ||= { n: 0, sec: {} }); b.n++; if (n.section) b.sec[n.section] = (b.sec[n.section] || 0) + 1; }
    if (!['all', 'journal', 'trash'].includes(S.book) && !books[S.book]) books[S.book] = { n: 0, sec: {} };
    if (S.section && books[S.book] && !books[S.book].sec[S.section]) books[S.book].sec[S.section] = 0;
    const on = (b, s = null) => S.book === b && (S.section || null) === s;
    const row = (cls, b, s, label, count, drop = '') => `<div class="nt-b ${cls} ${on(b, s) ? 'on' : ''}" data-book="${esc(b)}" data-sec="${esc(s || '')}" ${drop ? `data-drop="${drop}"` : ''}>${label}<em>${count}</em></div>`;
    let h = row('', 'all', null, '◈ ALL NOTES', live.length)
      + row('', 'journal', null, S.state?.unlocked ? '✎ JOURNAL' : '🔒 JOURNAL', S.state?.unlocked ? live.filter((n) => n.journal).length : S.state?.lockedJournal || '')
      + '<div class="nt-bhead">NOTEBOOKS</div>'
      + (S.adding === 'book' ? '<input class="nt-name" id="nt-name" maxlength="60" placeholder="name your notebook, press Enter">' : '');
    if (!Object.keys(books).length && S.adding !== 'book') h += '<div class="nt-hint">No notebooks yet. Press <b>+ NEW NOTEBOOK</b> above.</div>';
    for (const b of Object.keys(books).sort()) {
      const open = S.book === b;
      h += row('book', b, null, `<i class="nt-caret">${open ? '▾' : '▸'}</i><i class="nt-dot" style="background:${color(b)}"></i><span>${esc(b)}</span>`, books[b].n, 'book');
      if (!open) continue;
      h += Object.keys(books[b].sec).sort().map((s) => row('sec', b, s, `<i class="nt-bar2" style="background:${color(b + s)}"></i><span>${esc(s)}</span>`, books[b].sec[s], 'sec')).join('');
      h += S.adding === 'sec' ? '<input class="nt-name sec" id="nt-name" maxlength="60" placeholder="name the section, press Enter">' : '<div class="nt-b sec add" id="nt-addsec">+ new section in this notebook</div>';
    }
    h += row('trash', 'trash', null, '⌫ TRASH', S.list.filter((n) => n.deleted).length, 'trash');
    $('#nt-books').innerHTML = h;
    $$('#nt-books .nt-b[data-book]').forEach((el) => {
      el.addEventListener('click', async () => {
        const b = el.dataset.book, s = el.dataset.sec || null;
        S.section = s; S.book = b; S.adding = null;
        renderBooks(); renderList();
        if (S.book === 'journal' && !S.state.unlocked) { await flush(); journalPrompt(); }
      });
      if (!el.dataset.drop) return;
      el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/hs-note')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); dropPage(e.dataTransfer.getData('text/hs-note'), el.dataset.drop, el.dataset.book, el.dataset.sec); });
    });
    $('#nt-addsec')?.addEventListener('click', async () => { await flush(); S.adding = 'sec'; renderBooks(); });
    const name = $('#nt-name');
    if (name) {
      name.focus(); name.scrollIntoView({ block: 'nearest' });
      name.addEventListener('blur', () => setTimeout(() => { if (S.adding && document.activeElement?.id !== 'nt-name') { S.adding = null; renderBooks(); } }, 200));
      name.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') { S.adding = null; return renderBooks(); }
        if (e.key !== 'Enter' || !name.value.trim()) return;
        e.preventDefault();
        const v = name.value.trim(), kind = S.adding; S.adding = null;
        startContainer(kind, v);
      });
    }
    renderWhere();
  }
  // A notebook or section only exists once it holds a page, so making one starts its first page for you.
  async function startContainer(kind, name) {
    await flush(); await dropIfEmpty();
    if (kind === 'book') { S.book = name; S.section = null; } else S.section = name;
    await newNote({ title: 'First page', start: 'body' });
  }
  function renderWhere() {
    const el = $('#nt-where');
    if (!el) return;
    const fixed = { all: 'ALL NOTES', journal: 'JOURNAL', trash: 'TRASH' }[S.book];
    el.innerHTML = (fixed ? `<b>${fixed}</b>` : `<b style="color:${color(S.book)}">${esc(S.book)}</b>${S.section ? ` <span>› ${esc(S.section)}</span>` : ''}`) + `<em id="nt-count"></em>`;
    $('#nt-addpage')?.classList.toggle('hidden', S.book === 'trash');
  }
  // a page dragged from the list onto a notebook, a section or the trash
  async function dropPage(id, kind, book, section) {
    if (!id) return;
    await flush();
    if (kind === 'trash') { await call('notesDelete', id); toast('MOVED TO TRASH'); if (S.cur?.id === id) { S.cur = null; renderEditor(); } return loadList(); }
    const n = S.cur?.id === id ? S.cur : await call('notesGet', id);
    if (!n || n.deleted) return;
    Object.assign(n, { notebook: book, section: kind === 'sec' ? section : '' });
    await call('notesSave', { id: n.id, title: n.title, body: n.body, blobs: n.blobs, notebook: n.notebook, section: n.section, journal: n.journal });
    toast(`MOVED TO ${book.toUpperCase()}${n.section ? ` › ${n.section.toUpperCase()}` : ''}`);
    await loadList(); if (S.cur?.id === id) renderEditor();
  }

  const isSectionPdf = (n) => (/: whole section \(PDF\)$/.test(n.title || '') ? 1 : 0);
  function visible() {
    let l = S.list.filter((n) => (S.book === 'trash' ? n.deleted : !n.deleted));
    if (S.book === 'journal') l = l.filter((n) => n.journal);
    else if (!['all', 'trash'].includes(S.book)) l = l.filter((n) => n.notebook === S.book && (!S.section || n.section === S.section));
    if (S.hits) l = l.filter((n) => S.hits.has(n.id));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    if (S.filter === 'files') l = l.filter((n) => n.pics > 0);
    else if (S.filter === 'todos') l = l.filter((n) => n.todos > 0);
    else if (S.filter === 'today') l = l.filter((n) => new Date(n.updated) >= day);
    else if (S.filter === 'week') l = l.filter((n) => Date.now() - new Date(n.updated) < 7 * 864e5);
    const [by, dir] = S.sort.split('-'), sign = dir === 'new' || dir === 'za' ? -1 : 1;
    const key = (n) => (by === 'title' ? String(n.title || 'Untitled').toLowerCase() : String(by === 'created' ? n.created : n.updated));
    // the OneNote import's "whole section (PDF)" pages are only a backup picture of each section: they always go last
    return l.sort((a, b) => (isSectionPdf(a) - isSectionPdf(b)) || sign * key(a).localeCompare(key(b), undefined, { numeric: true }));
  }
  function renderList() {
    const l = visible();
    let pdfHead = false;
    $('#nt-list').innerHTML = l.length ? l.slice(0, 400).map((n) => {
      const pdf = isSectionPdf(n);
      const head = pdf && !pdfHead && l.length > 1 ? ((pdfHead = true), '<div class="nt-lhead">SECTION PDFS · BACKUP PICTURES FROM ONENOTE</div>') : '';
      const where = S.book === 'all' || S.q ? ` · ${esc(n.notebook || '')}` : !S.section && n.section ? ` · ${esc(n.section)}` : '';
      const date = S.sort.startsWith('created') ? `new ${when(n.created)}` : when(n.updated);
      return `${head}<div class="nt-p ${pdf ? 'pdf' : ''} ${S.cur?.id === n.id ? 'on' : ''}" data-id="${n.id}" draggable="${S.book !== 'trash'}">
        <b>${pdf ? `📄 ${esc((n.title || '').replace(/: whole section \(PDF\)$/, ''))} · section PDF` : esc(n.title || 'Untitled')}</b><span>${date}${where}${n.pics ? ` · ${n.pics} 📎` : ''}${n.todos ? ` · ${n.todos} ☐` : ''}</span>
        ${pdf ? '' : `<p>${esc(n.preview)}</p>`}</div>`;
    }).join('') : `<div class="nt-empty">${S.q ? 'Nothing matches your search.' : S.filter !== 'all' ? 'No pages match this filter. Choose “ALL PAGES”.' : S.book === 'trash' ? 'Trash is empty.' : 'No pages here yet.<br>Press <b>+ NEW PAGE</b> to write one.'}</div>`;
    $$('#nt-list .nt-p').forEach((el) => {
      el.addEventListener('click', () => openNote(el.dataset.id));
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/hs-note', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; root.classList.add('nt-dragging'); });
      el.addEventListener('dragend', () => root.classList.remove('nt-dragging'));
    });
    renderWhere();
    const c = $('#nt-count'); if (c) c.textContent = ` ${l.length} ${l.length === 1 ? 'page' : 'pages'}`;
  }

  // ---------------- one page ----------------
  // S.cur is THE page on screen, and it is never swapped for a copy: typing changes it in place, saving only adds
  // what the vault decides (dates). (The old code swapped it after each save, so later typing went into a stale copy.)
  async function openNote(id) {
    if (S.cur?.id === id) { $('#nt-body')?.focus(); return; }
    const tok = ++S.tok;
    await flush(); await dropIfEmpty();
    const n = await call('notesGet', id);
    if (!n || tok !== S.tok) return;
    S.cur = n; S.dirty = false;
    renderList(); renderEditor();
    if (!n.deleted) $('#nt-body')?.focus();
  }
  // the page you just made and left without typing anything goes away by itself (never one with a title, text or files)
  async function dropIfEmpty() {
    const c = S.cur;
    if (!c || c.deleted || S.fresh !== c.id) return;
    if (String(c.title || '').trim() || String(c.body || '').trim() || (c.blobs || []).length) { S.fresh = null; return; }
    S.fresh = null; S.cur = null;
    await call('notesDelete', c.id, true).catch(() => {});
    S.list = S.list.filter((x) => x.id !== c.id); renderBooks(); renderList();
  }
  const EMPTY = `<div class="nt-empty big"><div class="nt-bigprompt">&gt; <i class="nt-cursor"></i></div><p><b>Pick a page</b> from the list on the left, or</p><button class="nt-go" id="nt-empty-new">+ START A NEW PAGE</button><p class="dim">Everything you type is saved by itself and encrypted.</p></div>`;
  function renderEditor() {
    const n = S.cur, ed = $('#nt-edit');
    if (!ed) return;
    if (!n) { ed.innerHTML = EMPTY; $('#nt-empty-new')?.addEventListener('click', () => newNote()); return; }
    const gone = !!n.deleted, tool = (f, label, title) => `<button data-f="${f}" title="${title}">${label}</button>`;
    ed.innerHTML = `
      <div class="nt-ehead">
        <div class="nt-path"><span>hyperspace@notes</span>:<em id="nt-path"></em>$<i class="nt-cursor"></i></div>
        <input class="nt-title" id="nt-title" value="${esc(n.title || '')}" placeholder="Page title…" ${gone ? 'disabled' : ''} maxlength="200">
        <div class="nt-meta"><span>created ${when(n.created)} · edited ${when(n.updated)}</span><span id="nt-saved" class="nt-saved"></span></div>
        <div class="nt-tools">
          ${gone ? '<button class="act" id="nt-restore">RESTORE</button><button class="act danger" id="nt-forever">DELETE FOREVER</button>' : `
          <span class="nt-fmt">${tool('h', 'H', 'Heading')}${tool('b', '<b>B</b>', 'Bold')}${tool('i', '<i>I</i>', 'Italic')}${tool('li', '• LIST', 'Bulleted list')}${tool('box', '☐ TO-DO', 'To-do you can tick')}${tool('pic', '🖼 PICTURE', 'Add a picture')}<button id="nt-attach" title="Attach any file: PDF, Word, audio… (or drag files onto the page)">📎 FILE</button></span>
          <button class="act ${S.preview ? 'on' : ''}" id="nt-prev" title="Show how the page looks finished, next to the text">${S.preview ? '◨ HIDE PREVIEW' : '◨ SHOW PREVIEW'}</button>
          <span class="grow"></span><button class="act" id="nt-move">MOVE</button><button class="act" id="nt-hist">HISTORY</button><button class="act danger" id="nt-del">DELETE</button>`}
        </div>
      </div>
      <div class="nt-work ${S.preview && !gone ? 'split' : ''} ${gone ? 'only-read' : ''}">
        ${gone ? '' : '<textarea id="nt-body" spellcheck="true" placeholder="Start typing here…&#10;&#10;# heading   **bold**   - list   - [ ] to-do"></textarea>'}
        <div class="nt-read" id="nt-read"></div>
      </div>
      <input type="file" id="nt-file" accept="image/*" hidden><input type="file" id="nt-files" multiple hidden>
      ${gone ? '' : '<div class="nt-dropzone">DROP FILES TO ADD THEM TO THIS PAGE · ENCRYPTED</div>'}`;
    showPath();
    const ta = $('#nt-body'), read = $('#nt-read');
    if (ta) ta.value = n.body || '';
    renderPreview();
    read.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a?.dataset.ext) { e.preventDefault(); call('scOpen', a.getAttribute('href')).catch(() => {}); }
      const f = e.target.closest('[data-fact]');
      if (!f) return;
      const card = f.closest('.nt-file');
      const name = card.dataset.name.replace(/^Open the section PDF$/, `${S.cur.title || 'section'}`);
      if (f.dataset.fact === 'open') { toast('OPENING A TEMPORARY COPY · DELETED WHEN THE JOURNAL LOCKS OR HYPERSPACE CLOSES'); call('notesOpenBlob', card.dataset.blob, name).catch((er) => toast(`COULDN'T OPEN IT: ${er.message}`, true)); }
      else call('notesSaveBlob', card.dataset.blob, name);
    });
    read.addEventListener('change', (e) => { // tick a to-do in the finished view: the text on the left follows
      const cb = e.target.closest('input[data-line]');
      if (!cb || !ta) return;
      const lines = ta.value.split('\n'), k = +cb.dataset.line;
      if (lines[k] === undefined) return;
      lines[k] = lines[k].replace(/\[[ xX]\]/, cb.checked ? '[x]' : '[ ]');
      ta.value = lines.join('\n'); S.cur.body = ta.value; changed();
    });
    $('#nt-title')?.addEventListener('input', (e) => { S.cur.title = e.target.value; showPath(); changed(); });
    ta?.addEventListener('input', () => { S.cur.body = ta.value; changed(); });
    ta?.addEventListener('paste', async (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); await addFiles(files); }
    });
    ta?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('SAVED')); return; }
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); return; }
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.isComposing) return;
      // pressing Enter inside a list carries on the list ("- ", "1. ", "- [ ] "); on an empty item it ends the list
      const at = ta.selectionStart, start = ta.value.lastIndexOf('\n', at - 1) + 1, line = ta.value.slice(start, at);
      const m = /^(\s*)([-*]|\d+\.)\s(\[[ xX]\]\s)?/.exec(line);
      if (!m || ta.selectionEnd !== at) return;
      e.preventDefault();
      if (line.length === m[0].length) { ta.setSelectionRange(start, at); document.execCommand('delete'); return; }
      const mark = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2];
      document.execCommand('insertText', false, `\n${m[1]}${mark} ${m[3] ? '[ ] ' : ''}`);
    });
    $$('#nt-edit [data-f]').forEach((b) => b.addEventListener('click', () => format(b.dataset.f)));
    $('#nt-prev')?.addEventListener('click', () => { S.preview = !S.preview; pref.set({ preview: S.preview }); const keep = $('#nt-body')?.selectionStart; renderEditor(); const t = $('#nt-body'); if (t) { t.focus(); if (keep != null) t.setSelectionRange(keep, keep); } });
    $('#nt-file').addEventListener('change', (e) => { if (e.target.files[0]) addPicture(e.target.files[0]); e.target.value = ''; });
    $('#nt-files').addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
    $('#nt-attach')?.addEventListener('click', () => $('#nt-files').click());
    $('#nt-del')?.addEventListener('click', async () => { await flush(); const id = S.cur.id; S.cur = null; await call('notesDelete', id); toast('MOVED TO TRASH'); renderEditor(); loadList(); });
    $('#nt-restore')?.addEventListener('click', async () => { const id = S.cur.id; await call('notesRestore', id); toast('RESTORED'); S.cur = null; renderEditor(); loadList(); });
    $('#nt-forever')?.addEventListener('click', async () => { if (!confirm('Delete this page forever? It also disappears from the SSD and server copies.')) return; const id = S.cur.id; S.cur = null; await call('notesDelete', id, true); renderEditor(); loadList(); });
    $('#nt-hist')?.addEventListener('click', () => history(S.cur));
    $('#nt-move')?.addEventListener('click', () => move(S.cur));
  }
  const showPath = () => { const n = S.cur, el = $('#nt-path'); if (n && el) el.textContent = `~/${[n.notebook || 'Notes', n.section, n.title || 'untitled'].filter(Boolean).join('/')}`; };
  let prevT;
  function renderPreview() {
    const read = $('#nt-read'), n = S.cur;
    if (!read || !n) return;
    read.innerHTML = md(n.body) || '<p class="dim">The finished page shows up here as you type.</p>';
    fillBlobs(read);
  }
  function format(f) {
    const ta = $('#nt-body');
    if (!ta) return;
    if (f === 'pic') return $('#nt-file').click();
    const [a, b] = [ta.selectionStart, ta.selectionEnd], sel = ta.value.slice(a, b);
    const lineStart = ta.value.lastIndexOf('\n', a - 1) + 1;
    ta.focus();
    if (f === 'b' || f === 'i') { const m = f === 'b' ? '**' : '*'; ta.setSelectionRange(a, b); document.execCommand('insertText', false, m + (sel || 'text') + m); if (!sel) ta.setSelectionRange(a + m.length, a + m.length + 4); }
    else { const pre = { h: '## ', li: '- ', box: '- [ ] ' }[f]; ta.setSelectionRange(lineStart, lineStart); document.execCommand('insertText', false, pre); ta.setSelectionRange(b + pre.length, b + pre.length); }
    S.cur.body = ta.value; changed();
  }
  async function addPicture(file) {
    const cur = S.cur;
    if (!cur) return;
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const bid = await call('notesPicture', url, !!cur.journal);
    S.blobs.set(bid, Promise.resolve(url));
    insertTag(cur, `![picture](hs-blob:${bid})`, bid);
    toast('PICTURE ADDED · ENCRYPTED');
  }
  // any files: pictures show on the page, everything else becomes a card with OPEN / SAVE A COPY
  async function addFiles(files) {
    const cur = S.cur;
    if (!cur || cur.deleted) return;
    for (const f of files) {
      if (f.type.startsWith('image/') && f.size < 30e6) { await addPicture(f); continue; }
      try {
        toast(`ENCRYPTING ${(f.name || 'FILE').toUpperCase()}…`);
        const bid = await call('notesAttach', f.name || 'file', await f.arrayBuffer(), !!cur.journal);
        insertTag(cur, `[${(f.name || 'file').replace(/[[\]]/g, '')}](hs-blob:${bid})`, bid);
        toast(`ADDED ${f.name.toUpperCase()} · ENCRYPTED`);
      } catch (e) { toast(`COULDN'T ADD ${String(f.name).toUpperCase()}: ${e.message.replace(/^Error invoking remote method 'api': (Error: )?/, '')}`, true); }
    }
  }
  // at the cursor (or the end, if the page isn't the one on screen any more)
  function insertTag(cur, tag, bid) {
    const ta = S.cur === cur ? $('#nt-body') : null;
    if (ta) { const at = ta.selectionStart ?? ta.value.length; ta.value = `${ta.value.slice(0, at)}\n${tag}\n${ta.value.slice(at)}`; cur.body = ta.value; }
    else cur.body = `${(cur.body || '').trimEnd()}\n\n${tag}\n`;
    cur.blobs = [...(cur.blobs || []), bid];
    if (S.cur === cur) { changed(); renderPreview(); }
    else call('notesSave', { id: cur.id, title: cur.title, body: cur.body, blobs: cur.blobs, notebook: cur.notebook, section: cur.section, journal: cur.journal }).then(loadList).catch(() => {});
  }

  // ---- saving: every change is saved within a second, one save at a time, in order ----
  let saveT, saving = Promise.resolve();
  function changed() {
    S.dirty = true; if ($('#nt-saved')) $('#nt-saved').textContent = 'saving…';
    clearTimeout(saveT); saveT = setTimeout(flush, 800);
    clearTimeout(prevT); prevT = setTimeout(renderPreview, 150);
  }
  function flush() {
    clearTimeout(saveT);
    saving = saving.then(doSave, doSave);
    return saving;
  }
  async function doSave() {
    const n = S.cur;
    if (!S.dirty || !n) return;
    S.dirty = false;
    const snap = { id: n.id, title: n.title, body: n.body, blobs: n.blobs, notebook: n.notebook, section: n.section, journal: n.journal };
    let saved;
    try { saved = await call('notesSave', snap); }
    catch (e) {
      if (S.cur === n) { S.dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 5000); }
      toast(`NOT SAVED YET: ${String(e.message).replace(/^Error invoking remote method 'api': (Error: )?/, '')} · TRYING AGAIN`, true);
      return;
    }
    // take over only what the vault decides; the text on screen stays as it is (you may have typed more while it saved)
    Object.assign(n, { id: saved.id, created: saved.created, updated: saved.updated, journal: !!saved.journal });
    if (S.cur === n && $('#nt-saved')) $('#nt-saved').textContent = S.dirty ? 'saving…' : 'saved ✓ encrypted';
    const meta = metaOf({ ...saved, title: snap.title, body: snap.body, blobs: snap.blobs });
    const k = S.list.findIndex((x) => x.id === saved.id);
    if (k >= 0) S.list[k] = meta; else S.list.push(meta);
    renderList();
  }
  // a new page opens ready to type: in the title, or in the text for the first page of a new notebook / section
  async function newNote(o = {}) {
    if (S.book === 'journal' && !o.title) return newJournal();
    await flush(); await dropIfEmpty();
    const book = !['all', 'journal', 'trash'].includes(S.book) ? S.book : 'Notes';
    S.q = ''; S.hits = null; S.filter = 'all'; if ($('#nt-q')) $('#nt-q').value = ''; if ($('#nt-filter')) $('#nt-filter').value = 'all';
    const n = await call('notesSave', { title: o.title || '', body: '', notebook: book, section: S.section || '' }).catch((e) => { toast(`COULDN'T START A PAGE: ${String(e.message).replace(/^Error invoking remote method 'api': (Error: )?/, '')}`, true); return null; });
    if (!n) return;
    S.cur = n; S.dirty = false; S.fresh = n.id; S.tok++;
    if (!S.list.some((x) => x.id === n.id)) S.list.push(metaOf(n));
    renderBooks(); renderList(); renderEditor();
    (o.start === 'body' || o.title ? $('#nt-body') : $('#nt-title'))?.focus();
  }
  async function newJournal() {
    await flush(); await dropIfEmpty();
    if (!S.state.unlocked) { S.book = 'journal'; S.section = null; renderBooks(); renderList(); return journalPrompt(newJournal); }
    const d = new Date();
    const n = await call('notesSave', { title: d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), body: '', notebook: 'Journal', section: String(d.getFullYear()), journal: true });
    S.cur = n; S.dirty = false; S.book = 'journal'; S.section = null; S.tok++;
    if (!S.list.some((x) => x.id === n.id)) S.list.push(metaOf(n));
    renderBooks(); renderList(); renderEditor(); $('#nt-body')?.focus();
  }
  function move(n) {
    const books = [...new Set(S.list.filter((x) => !x.deleted).map((x) => x.notebook || 'Notes'))].sort();
    modal(`<h3>Move "${esc(n.title || 'Untitled')}"</h3>
      <label>Notebook</label><input id="mv-b" list="mv-books" value="${esc(n.notebook || '')}"><datalist id="mv-books">${books.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <label>Section</label><input id="mv-s" value="${esc(n.section || '')}">
      <label class="nt-tick"><input type="checkbox" id="mv-j" ${n.journal ? 'checked' : ''} ${S.state.unlocked ? '' : 'disabled'}> journal entry (password protected)${S.state.unlocked ? '' : ' · unlock the journal to change this'}</label>
      <button class="nt-go" id="mv-go">MOVE</button>`, (box) => {
      box.querySelector('#mv-go').addEventListener('click', async () => {
        Object.assign(S.cur, { notebook: box.querySelector('#mv-b').value.trim() || 'Notes', section: box.querySelector('#mv-s').value.trim(), journal: box.querySelector('#mv-j').checked });
        S.dirty = true; await flush(); closeModal(); renderBooks(); renderEditor();
      });
    });
  }
  async function history(n) {
    await flush();
    const h = await call('notesHistory', n.id);
    modal(`<h3>Earlier versions</h3><p class="dim">A version is kept every time a page is edited after a 10-minute break (the last 20), and whenever another copy had a newer one.</p>
      <div class="nt-hist">${h.length ? h.map((v) => `<button data-at="${v.at}">${new Date(v.at).toLocaleString()}</button>`).join('') : '<p class="dim">No earlier versions yet.</p>'}</div><div id="nt-hv"></div>`, (box) => {
      box.querySelectorAll('[data-at]').forEach((b) => b.addEventListener('click', async () => {
        const v = await call('notesVersion', n.id, +b.dataset.at);
        box.querySelector('#nt-hv').innerHTML = `<div class="nt-read small">${md(v.body)}</div><button class="nt-go" id="nt-hr">RESTORE THIS VERSION</button>`;
        fillBlobs(box.querySelector('#nt-hv'));
        box.querySelector('#nt-hr').addEventListener('click', async () => { Object.assign(S.cur, { title: v.title, body: v.body, blobs: v.blobs }); S.dirty = true; await flush(); closeModal(); renderEditor(); toast('VERSION RESTORED'); });
      }));
    });
  }

  // ---------------- import, copies, vault settings ----------------
  async function importOneNote() {
    const guess = await call('notesExportFolderGuess').catch(() => null);
    modal(`<h3>Bring your OneNote in</h3>
      <p class="dim">Every page is encrypted the moment it's imported. Running an import again only adds what's new.</p>
      <button class="nt-go" id="im-folder">FROM EXPORTED FILES${guess ? ' (Documents\OneNote Notes found)' : ''}</button>
      <p class="dim">Folders of notebooks with a .txt file per page, its pictures beside it, and a PDF per section.</p>
      <button class="nt-go ghost" id="im-app">FROM THE ONENOTE APP</button>
      <p class="dim">Reads straight out of OneNote for Windows, if it's still installed.</p>`, (box) => {
      box.querySelector('#im-folder').addEventListener('click', () => run(() => call('notesImportFolder', guess)));
      box.querySelector('#im-app').addEventListener('click', () => run(() => call('notesImport')));
    });
    async function run(fn) {
      closeModal();
      $('#nt-imp').classList.remove('hidden');
      $('#nt-imp').innerHTML = '<b>IMPORTING…</b> getting started';
      try { const r = await fn(); if (r) toast(`IMPORT DONE · ${r.added} PAGES ADDED`); else $('#nt-imp').classList.add('hidden'); }
      catch (e) { toast(`IMPORT FAILED: ${e.message}`, true); }
      loadList();
    }
  }
  hs.on('notes-import', (s) => {
    const el = $('#nt-imp');
    if (!el) return;
    el.classList.remove('hidden');
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    el.innerHTML = s.finished
      ? `<b>✓ ONENOTE IMPORTED</b> ${s.added} new pages${s.updated ? `, ${s.updated} updated` : ''}, ${s.skipped} already here${s.kept ? `, ${s.kept} kept because you edited them here` : ''}, ${s.pictures} pictures${s.pdfs ? `, ${s.pdfs} section PDFs` : ''}${s.errors ? `, <span class="bad">${s.errors} couldn't be read</span>` : ''}. Every page is encrypted. <button class="act" id="nt-imp-x">OK</button>`
      : `<b>IMPORTING FROM ONENOTE…</b> ${s.done} / ${s.total} pages · ${s.pictures} pictures <div class="nt-bar"><i style="width:${pct}%"></i></div>`;
    $('#nt-imp-x')?.addEventListener('click', () => el.classList.add('hidden'));
    if (s.done % 25 === 0 || s.finished) loadList();
  });

  function copies() {
    const s = S.state, el = $('#nt-copies');
    if (!el || !s) return;
    el.innerHTML = `<span class="ok">LAPTOP ✓</span>` + s.mirrors.map((m) => {
      const name = /^[A-Z]:\\/i.test(m.dir) ? m.dir.slice(0, 2) : m.dir.startsWith('\\\\') ? 'SERVER' : m.dir;
      return `<span class="${m.ok && m.here ? 'ok' : 'warn'}" title="${esc(m.dir)}">${esc(name)} ${m.ok && m.here ? `✓ ${ago(m.at)}` : m.running ? '…' : m.here ? '⚠' : '· not plugged in'}</span>`;
    }).join('') + (s.mirrors.length ? '' : '<span class="warn">only 1 copy: add the SSD in ⚙ VAULT</span>');
  }

  async function vaultSettings() {
    const s = await call('notesState');
    const drives = await call('notesDrives');
    modal(`<h3>Vault settings</h3>
      <label>Copies (besides this laptop)</label>
      <div class="nt-mir">${s.mirrors.map((m, k) => `<div><span>${esc(m.dir)}</span><em>${m.here ? (m.ok ? `synced ${ago(m.at)}` : m.error || '') : 'not reachable'}</em><button data-rm="${k}">✕</button></div>`).join('') || '<p class="dim">None yet.</p>'}</div>
      <div class="nt-row">${drives.filter((d) => !s.mirrors.some((m) => m.dir.toLowerCase() === d.suggest.toLowerCase())).map((d) => `<button class="act" data-add="${esc(d.suggest)}">+ ${esc(d.root)} ${esc(d.label)}</button>`).join('')}<button class="act" id="vs-pick">+ CHOOSE A FOLDER (SERVER…)</button><button class="act" id="vs-sync">SYNC NOW</button></div>
      <p class="dim">Home server later: share a folder on it, then add it here as \\\\servername\\share\\HYPERSPACE Notes (or map it to a drive letter).</p>
      <label>Lock automatically after</label><div class="nt-row"><input type="number" id="vs-min" min="0" max="240" value="${s.autoLockMin}" style="width:80px"> minutes without use (0 = only when Windows locks or sleeps)</div>
      <label>Change master password</label><input type="password" id="vs-old" placeholder="current password (or recovery key)"><input type="password" id="vs-new" placeholder="new password (10+ characters)"><input type="password" id="vs-new2" placeholder="new password again">
      <button class="nt-go" id="vs-pw">CHANGE PASSWORD</button>
      <p class="dim">The main copy lives in ${esc(s.dir)}.</p>`, (box) => {
      const setM = async (list) => { await call('notesMirrors', list); closeModal(); vaultSettings(); };
      box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => setM(s.mirrors.filter((_, k) => k !== +b.dataset.rm).map((m) => m.dir))));
      box.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => setM([...s.mirrors.map((m) => m.dir), b.dataset.add])));
      box.querySelector('#vs-pick').addEventListener('click', async () => { const d = await call('routerPickFolder', 'Choose a folder for a copy of your notes'); if (d) setM([...s.mirrors.map((m) => m.dir), d.endsWith('HYPERSPACE Notes') ? d : `${d.replace(/[\\/]$/, '')}\\HYPERSPACE Notes`]); });
      box.querySelector('#vs-sync').addEventListener('click', async () => { toast('SYNCING COPIES…'); await call('notesSyncNow'); closeModal(); vaultSettings(); });
      box.querySelector('#vs-min').addEventListener('change', (e) => call('notesAutoLock', +e.target.value));
      box.querySelector('#vs-pw').addEventListener('click', async () => {
        const o = box.querySelector('#vs-old').value, a = box.querySelector('#vs-new').value, b = box.querySelector('#vs-new2').value;
        if (a.length < 10) return toast('USE AT LEAST 10 CHARACTERS', true);
        if (a !== b) return toast("THE NEW PASSWORDS DON'T MATCH", true);
        try { await call('notesPassword', o, a); toast('PASSWORD CHANGED · THE COPIES UPDATE ON THEIR NEXT SYNC'); closeModal(); } catch (e) { toast(e.message.toUpperCase(), true); }
      });
    });
  }

  function modal(html, wire) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'nt-modal'; m.id = 'nt-modal';
    m.innerHTML = `<div class="nt-mbox panel"><button class="nt-x" id="nt-mx">✕</button>${html}</div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.id === 'nt-mx') closeModal(); });
    wire(m);
  }
  function closeModal() { $('#nt-modal')?.remove(); }

  hs.on('notes-state', async (s) => {
    const was = S.state?.unlocked, count = S.state?.count;
    S.state = s;
    if (!s.open) { S.cur = null; S.list = []; S.blobs.clear(); closeModal(); if (s.exists) lockScreen(); return; }
    if (!root.querySelector('.nt-app')) { refresh(); return; } // opened from somewhere else: show the notes
    copies(); lockButton();
    if (was && !s.unlocked) { // the journal just locked: hide its pages
      if (S.cur?.journal) { S.cur = null; S.dirty = false; renderEditor(); }
      S.blobs.clear(); closeModal(); await loadList();
      if (S.book === 'journal') journalPrompt();
      if (s.why && s.why !== 'locked') toast(`JOURNAL LOCKED · ${s.why.toUpperCase()}`);
    } else if (!was && s.unlocked) await loadList();
    else if (count !== undefined && s.count !== count && !S.adding) await loadList(); // pages arrived from another copy
  });
  hs.on('config', () => window.drawAccentRow?.($('#nt-acc')));
  HS.viewListeners.push((v) => { if (v === 'notes' && !root.querySelector('.nt-app, .nt-card')) refresh(); if (v !== 'notes') flush(); });
  window.addEventListener('beforeunload', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  refresh();
})();
