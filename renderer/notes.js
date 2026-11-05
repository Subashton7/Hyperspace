// NOTES: the encrypted notebook + journal that replaces OneNote. Everything is decrypted in the laptop's main
// process only while unlocked; this page asks for one note at a time. See src/notes.js for the vault itself.
(() => {
  const root = $('#view-notes');
  if (!root || hs.remote) { if (root) root.innerHTML = '<div class="nt-center"><p>NOTES only opens on the laptop itself.</p></div>'; return; }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = { hist: [], state: null, list: [], book: 'all', section: null, q: '', hits: null, cur: null, dirty: false, blobs: new Map() };
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

  // ---------------- Markdown → HTML (escaped first, so a note can never run code) ----------------
  const FONTS = { serif: 'Georgia, serif', sans: 'Arial, sans-serif', mono: 'Consolas, monospace', hand: "'Segoe Script', 'Comic Sans MS', cursive", display: 'Impact, sans-serif' };
  // {c:#ff0|text} colour · {h:#ff0|text} highlight · {s:20|text} size in px · {f:serif|text} font. Anything invalid is left as plain text.
  const span = (m, k, v, t) => {
    v = v.trim();
    if ((k === 'c' || k === 'h') && /^#[0-9a-f]{3,8}$/i.test(v)) return `<span style="${k === 'c' ? 'color' : 'background'}:${v}">${t}</span>`;
    if (k === 's' && /^\d{1,2}$/.test(v) && +v >= 8 && +v <= 72) return `<span style="font-size:${v}px">${t}</span>`;
    if (k === 'f' && FONTS[v]) return `<span style="font-family:${FONTS[v]}">${t}</span>`;
    return m;
  };
  function inline(s) {
    return esc(s)
      .replace(/\{([cshf]):([^|{}]{1,20})\|([^{}]*)\}/g, (m, k, v, t) => span(m, k, v, t))
      .replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
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
      const al = /^\{a:(left|center|right)\|(.*)\}$/.exec(l);
      if (al) { out.push(`<p style="text-align:${al[1]}">${inline(al[2])}</p>`); i++; continue; }
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
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s|>|\{a:)/.test(lines[i])) buf.push(lines[i++]);
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
    if (S.sec === 'vault' && !S.state.unlocked && !S.cur && !S.vpr) { S.vpr = true; journalPrompt(); } // opened straight into a locked Vault
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
      $('#nt-copy').addEventListener('click', () => { navigator.clipboard.writeText(data.recovery); twr({ do: 'react', name: 'copied' }); toast('COPIED · PASTE IT SOMEWHERE SAFE, THEN CLEAR IT'); });
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
    if (S.sec === 'bujo') { S.sec = 'vault'; pref.set({ sec: 'vault' }); applySec(); renderBooks(); renderList(); }
    $('#nt-edit').innerHTML = `<div class="nt-center"><div class="nt-card">
      <div class="nt-kicker">🔒 THE VAULT</div><h2>The Vault is locked</h2>
      ${S.state.lockedJournal ? `<p class="dim">${S.state.lockedJournal} journal ${S.state.lockedJournal === 1 ? 'page is' : 'pages are'} hidden until you unlock it. Only your Journal (the dated entries) is locked. Unlock once to release the rest of your notes.</p>` : ''}
      ${S.state.why ? `<p class="dim">Locked because ${esc(S.state.why)}.</p>` : ''}
      <div id="nt-junl" class="nt-unl"></div></div></div>`;
    unlockForm($('#nt-junl'), async () => { await loadList(); if (then) then(); else { $('#nt-edit').innerHTML = '<div class="nt-empty">Journal unlocked. Pick an entry, or start a new one.</div>'; } }, 'UNLOCK JOURNAL');
  }
  function lockButton() {
    try { const u = !!S.state?.unlocked; if (S.lastUnlocked !== undefined && S.lastUnlocked !== u) twr({ do: 'react', name: u ? 'unlock' : 'locked' }); S.lastUnlocked = u; } catch {}    const b = $('#nt-lock');
    if (b) b.textContent = S.state?.unlocked ? '🔒 LOCK JOURNAL' : '🔓 UNLOCK JOURNAL';
    const c = $('#nt-jchip');
    if (c) c.textContent = S.state?.unlocked ? 'JOURNAL OPEN' : 'JOURNAL LOCKED';
    topLabel();
  }
  // the bar of vault chips and tools folds away like the sidebar does; its button says how things stand
  function topLabel() {
    const t = $('#nt-topt'), bar = $('.nt-top');
    if (!t || !bar) return;
    bar.classList.toggle('closed', !S.top);
    t.textContent = `${S.top ? '▾' : '▸'} VAULT & TOOLS · ${S.state?.unlocked ? 'JOURNAL OPEN' : 'JOURNAL LOCKED'}`;
  }

  // ---------------- the screen ----------------
  // One sidebar on the left (notebooks, then the pages inside the one you picked, with search / filter / sort) and
  // the whole rest of the window is the page you're writing. There is no READ / EDIT switch: a page is always a
  // text box you can type in, with the finished look (pictures, files, ticking to-dos) beside it.
  const pref = {
    get() { try { return JSON.parse(localStorage.getItem('hs-notes-view') || '{}'); } catch { return {}; } },
    set(p) { try { localStorage.setItem('hs-notes-view', JSON.stringify({ ...pref.get(), ...p })); } catch {} },
  };
  const SORTS = [['edited-new', 'EDITED · NEWEST'], ['edited-old', 'EDITED · OLDEST'], ['created-new', 'CREATED · NEWEST'], ['created-old', 'CREATED · OLDEST'], ['title-az', 'TITLE · A → Z'], ['title-za', 'TITLE · Z → A'], ['manual', 'MY ORDER · DRAG PAGES']];
  const FILTERS = [['all', 'ALL PAGES'], ['files', 'PICTURES / FILES'], ['todos', 'OPEN TO-DOS'], ['today', 'EDITED TODAY'], ['week', 'EDITED THIS WEEK']];
  // MY ORDER: the order you dragged pages into, remembered per notebook / section (ids only, nothing secret)
  const ORD = {
    get() { try { return JSON.parse(localStorage.getItem('hs-notes-order') || '{}'); } catch { return {}; } },
    set(k, ids) { try { localStorage.setItem('hs-notes-order', JSON.stringify({ ...ORD.get(), [k]: ids })); } catch {} },
  };
  const scopeKey = () => `${S.book}|${S.section || ''}`;
  // where journal pages live (notebook + section names only), remembered so the locked section can still show up in the tree
  const JP = {
    get() { try { const a = JSON.parse(localStorage.getItem('hs-notes-jplaces') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
    set(a) { try { localStorage.setItem('hs-notes-jplaces', JSON.stringify(a)); } catch {} },
  };
  const rememberPlaces = () => {
    if (!S.state?.unlocked) return;
    const seen = new Map();
    for (const n of S.list) if (n.journal && !n.deleted) seen.set(`${n.notebook || 'Notes'} ${n.section || ''}`, [n.notebook || 'Notes', n.section || '']);
    JP.set([...seen.values()]);
  };
  const isLockPlace = (b, s) => JP.get().some(([pb, ps]) => pb === b && (s ? (ps === s || ps === '') : ps === ''));
  const lockedNow = (b, s) => b === 'journal' || (!S.state?.unlocked && isLockPlace(b, s));
  Object.assign(S, { sort: 'edited-new', filter: 'all', preview: true, adding: null, fresh: null, tok: 0 }, (() => { const v = pref.get(); return { sort: SORTS.some((x) => x[0] === v.sort) ? v.sort : 'edited-new', filter: FILTERS.some((x) => x[0] === v.filter) ? v.filter : 'all', preview: false, top: v.top === 'open', sec: ['notebook', 'vault', 'bujo'].includes(v.sec) ? v.sec : 'notebook' }; })());
  // The three sections of the Notes tab. THE VAULT holds the journal: every password-locked page and every page titled with a date.
  const inVault = (n) => !!n.journal || !!n.dated;
  const pool = () => S.list.filter((n) => (S.sec === 'vault' ? inVault(n) : !inVault(n)));

  function shell() {
    root.innerHTML = `<div class="nt-app sec-${S.sec}">
      <div class="nt-sec" id="nt-sec">${[['notebook', 'NOTEBOOK'], ['vault', 'THE VAULT'], ['bujo', 'BULLET JOURNAL']].map(([k, l]) => `<button data-sec="${k}" class="${S.sec === k ? 'on' : ''}">${k === 'vault' ? '🔒 ' : ''}${l}</button>`).join('')}</div>
      <div class="nt-top closed">
        <button class="nt-topt" id="nt-topt" title="Show or hide the vault status, accent colours, import and lock buttons"></button>
        <span class="nt-lockchip">🔒 ENCRYPTED</span><span class="nt-lockchip" id="nt-jchip"></span><span id="nt-copies" class="nt-copies"></span>
        <span class="grow"></span>
        <span class="nt-accl">ACCENT</span><div class="acc-row" id="nt-acc"></div>
        <button class="act" id="nt-cal" title="Month view of your journal entries">▦ CALENDAR</button>
        <button class="act" id="nt-journal">✎ JOURNAL ENTRY</button>
        <button class="act" id="nt-import">⇩ IMPORT ONENOTE</button><button class="act" id="nt-vault">⚙ VAULT</button><button class="act" id="nt-lock">🔒 LOCK JOURNAL</button>
      </div>
      <div class="nt-import hidden" id="nt-imp"></div>
      <div class="nt-cols">
        <div class="nt-side">
          <div class="nt-newrow"><button class="nt-addpage" id="nt-addpage">+ NEW PAGE</button><button class="nt-addbook" id="nt-addbook">+ NEW NOTEBOOK</button><button class="nt-addbook nt-tplbtn" id="nt-tpl" title="Start a page from a ready-made layout">▾ NEW FROM TEMPLATE</button></div>
          <div class="nt-books" id="nt-books"></div>
          <div class="nt-split" id="nt-split" title="Drag up or down to resize the notebook list and the page list (double-click resets)"></div>
          <div class="nt-phead">
            <div class="nt-where" id="nt-where"></div>
            <input type="search" id="nt-q" placeholder="search every note…">
            <div class="nt-fs"><select id="nt-filter" title="Show only some pages">${FILTERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select id="nt-sort" title="Order of the pages">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          </div>
          <div class="nt-list" id="nt-list"></div>
        </div>
        <div class="nt-edit" id="nt-edit"></div>
      </div>
      <div class="nt-bujo hidden" id="nt-bujo"></div></div>`;
    $('#nt-filter').value = S.filter; $('#nt-sort').value = S.sort;
    $('#nt-sec').addEventListener('click', (e) => { const b = e.target.closest('button[data-sec]'); if (b) setSec(b.dataset.sec); });
    wireSplit(); applySec();
    $('#nt-topt').addEventListener('click', () => { S.top = !S.top; pref.set({ top: S.top ? 'open' : 'closed' }); topLabel(); });
    topLabel();
    $('#nt-addpage').addEventListener('click', () => newNote());
    $('#nt-addbook').addEventListener('click', async () => { await flush(); S.adding = 'book'; renderBooks(); $('#nt-books').scrollTop = 0; });
    $('#nt-journal').addEventListener('click', () => newJournal());
    $('#nt-cal').addEventListener('click', () => calendar());
    $('#nt-tpl').addEventListener('click', () => templatePicker());
    $('#nt-lock').addEventListener('click', async () => {
      if (!S.state.unlocked) { if (S.sec !== 'vault') return setSec('vault'); return journalPrompt(); }
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
    S.list = await call('notesList'); rememberPlaces();
    if (S.book === 'journal' && S.state.unlocked) { S.book = 'all'; S.section = null; }
    renderBooks(); renderList(); if (!S.cur) renderEditor();
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
    const live = pool().filter((n) => !n.deleted);
    const books = {};
    for (const n of live) { const b = (books[n.notebook || 'Notes'] ||= { n: 0, sec: {} }); b.n++; if (n.section) b.sec[n.section] = (b.sec[n.section] || 0) + 1; }
    // while the journal is locked its pages are hidden, but the place they live in still shows (with a lock) inside its notebook
    if (S.sec === 'vault' && !S.state?.unlocked) for (const [pb, ps] of JP.get()) { const b = (books[pb] ||= { n: 0, sec: {} }); if (ps) b.sec[ps] ||= 0; }
    const jlocked = (b, s = null) => isLockPlace(b, s);
    if (!['all', 'journal', 'trash'].includes(S.book) && !books[S.book]) books[S.book] = { n: 0, sec: {} };
    if (S.section && books[S.book] && !books[S.book].sec[S.section]) books[S.book].sec[S.section] = 0;
    const on = (b, s = null) => S.book === b && (S.section || null) === s;
    const row = (cls, b, s, label, count, drop = '') => `<div class="nt-b ${cls} ${on(b, s) ? 'on' : ''}" data-book="${esc(b)}" data-sec="${esc(s || '')}" ${drop ? `data-drop="${drop}"` : ''} ${drop === 'book' || drop === 'sec' ? 'draggable="true"' : ''}>${label}<em>${count}</em></div>`;
    // only when this laptop has never seen where the locked pages live does a single locked row stand in for them
    let h = row('', 'all', null, S.sec === 'vault' ? '◈ ALL VAULT ENTRIES' : '◈ ALL NOTES', live.length)
      + (S.sec === 'vault' && !S.state?.unlocked && S.state?.lockedJournal && !JP.get().length ? row('', 'journal', null, '🔒 LOCKED PAGES', S.state.lockedJournal) : '')
      + '<div class="nt-bhead">NOTEBOOKS</div>'
      + (S.adding === 'book' ? '<input class="nt-name" id="nt-name" maxlength="60" placeholder="name your notebook, press Enter">' : '');
    if (!Object.keys(books).length && S.adding !== 'book') h += '<div class="nt-hint">No notebooks yet. Press <b>+ NEW NOTEBOOK</b> above.</div>';
    for (const b of Object.keys(books).sort()) {
      const open = S.book === b;
      h += row('book', b, null, `<i class="nt-caret">${open ? '▾' : '▸'}</i><i class="nt-dot" style="background:${color(b)}"></i><span>${jlocked(b) ? '🔒 ' : ''}${esc(b)}</span>`, jlocked(b) && !S.state?.unlocked ? '' : books[b].n, 'book');
      if (!open) continue;
      h += Object.keys(books[b].sec).sort().map((s) => row('sec', b, s, `<i class="nt-bar2" style="background:${color(b + s)}"></i><span>${isLockPlace(b, s) ? '🔒 ' : ''}${esc(s)}</span>`, jlocked(b, s) && !S.state?.unlocked ? '' : books[b].sec[s], 'sec')).join('');
      h += S.adding === 'sec' ? '<input class="nt-name sec" id="nt-name" maxlength="60" placeholder="name the section, press Enter">' : '<div class="nt-b sec add" id="nt-addsec">+ new section in this notebook</div>';
    }
    h += row('trash', 'trash', null, '⌫ TRASH', pool().filter((n) => n.deleted).length, 'trash');
    $('#nt-books').innerHTML = h;
    $$('#nt-books .nt-b[data-book]').forEach((el) => {
      el.addEventListener('click', async () => {
        const b = el.dataset.book, s = el.dataset.sec || null;
        S.section = s; S.book = b; S.adding = null;
        renderBooks(); renderList();
        if (!S.state.unlocked && lockedNow(b, s)) { await flush(); journalPrompt(); }
      });
      el.addEventListener('contextmenu', (e) => bookMenu(e, el.dataset.book, el.dataset.sec || null));
      if (!el.dataset.drop) return;
      el.addEventListener('dragover', (e) => {
        const t = e.dataTransfer.types;
        if (t.includes('text/hs-note') || (t.includes('text/hs-cont') && el.dataset.drop !== 'trash' && S.dragCont && !(S.dragCont.b === el.dataset.book && (S.dragCont.s || '') === (el.dataset.sec || '')))) { e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('drop');
        if (e.dataTransfer.types.includes('text/hs-cont')) { const src = S.dragCont; S.dragCont = null; root.classList.remove('nt-dragging'); if (src) moveContainer(src, { b: el.dataset.book, s: el.dataset.sec || null }); return; }
        dropPage(e.dataTransfer.getData('text/hs-note'), el.dataset.drop, el.dataset.book, el.dataset.sec);
      });
    });
    // notebooks and sections are draggable too: drop one on another notebook (or section) to file it there
    $$('#nt-books .nt-b[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (e) => { S.dragCont = { b: el.dataset.book, s: el.dataset.sec || null }; e.dataTransfer.setData('text/hs-cont', JSON.stringify(S.dragCont)); e.dataTransfer.effectAllowed = 'move'; root.classList.add('nt-dragging'); });
      el.addEventListener('dragend', () => { S.dragCont = null; root.classList.remove('nt-dragging'); $$('#nt-books .drop').forEach((x) => x.classList.remove('drop')); });
    });
    // a section dropped on empty space in the list becomes a notebook of its own
    const bx = $('#nt-books');
    bx.ondragover = (e) => { if (S.dragCont?.s && e.dataTransfer.types.includes('text/hs-cont') && !e.target.closest('.nt-b')) { e.preventDefault(); bx.classList.add('drop'); } };
    bx.ondragleave = (e) => { if (!bx.contains(e.relatedTarget)) bx.classList.remove('drop'); };
    bx.ondrop = (e) => { bx.classList.remove('drop'); if (S.dragCont?.s && !e.target.closest('.nt-b')) { e.preventDefault(); const src = S.dragCont; S.dragCont = null; moveContainer(src, { top: true }); } };
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
    const fixed = { all: S.sec === 'vault' ? 'THE VAULT' : 'ALL NOTES', journal: 'JOURNAL', trash: 'TRASH' }[S.book];
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

  // Move a whole notebook or section. dest = { b, s } (into that notebook / section) or { top: true } (a section becomes a notebook).
  // A notebook filed under another notebook becomes a section of it (its own sections become "name › section").
  async function moveContainer(src, dest) {
    const sb = src.b, ss = src.s || null;
    if (!dest.top && dest.b === sb && (dest.s || null) === ss) return;
    if (!dest.top && !ss && dest.b === sb) return toast("A NOTEBOOK CAN'T GO INTO ITSELF", true);
    if (dest.top && !ss) return;
    const pages = pool().filter((n) => !n.deleted && (n.notebook || 'Notes') === sb && (!ss || n.section === ss));
    if (!pages.length) return;
    await flush();
    const target = (n) => {
      if (dest.top) return { notebook: ss, section: '' };
      return { notebook: dest.b, section: dest.s || (ss ? ss : n.section ? `${sb} › ${n.section}` : sb) };
    };
    toast('MOVING…');
    let done = 0;
    for (const m of pages) {
      const n = await call('notesGet', m.id); if (!n) continue;
      const t = target(n);
      await call('notesSave', { id: n.id, title: n.title, body: n.body, blobs: n.blobs, notebook: t.notebook, section: t.section, journal: n.journal, jm: n.jm, keepDates: true, updated: n.updated }).then(() => done++).catch(() => {});
    }
    const where = dest.top ? { b: ss, s: null } : { b: dest.b, s: dest.s || (ss ? ss : sb) };
    S.book = where.b; S.section = where.s; S.cur = null; renderEditor();
    toast(`MOVED ${done} ${done === 1 ? 'PAGE' : 'PAGES'} TO ${(dest.top ? ss : dest.b + (where.s ? ' › ' + where.s : '')).toUpperCase()}`);
    await loadList();
  }
  // "Move to…": pick a notebook (and optionally a section) from the ones that exist
  function moveDialog(title, { top = false, skipBook = null } = {}, pick) {
    const live = pool().filter((n) => !n.deleted), books = new Map();
    for (const n of live) { const b = n.notebook || 'Notes'; if (!books.has(b)) books.set(b, new Set()); if (n.section) books.get(b).add(n.section); }
    if (!books.size) books.set('Notes', new Set());
    const names = [...books.keys()].filter((b) => b !== skipBook).sort();
    modal(`<h3>Move ${esc(title)} to…</h3>
      <label>Notebook</label><select id="mc-b">${top ? '<option value="">— its own notebook (top level) —</option>' : ''}${names.map((b) => `<option>${esc(b)}</option>`).join('')}</select>
      <label>Section inside it (optional)</label><select id="mc-s"></select>
      <button class="nt-go" id="mc-go">MOVE</button>`, (box) => {
      const bs = box.querySelector('#mc-b'), ss = box.querySelector('#mc-s');
      const fill = () => { const secs = [...(books.get(bs.value) || [])].sort(); ss.innerHTML = '<option value="">— none —</option>' + secs.map((x) => `<option>${esc(x)}</option>`).join(''); ss.disabled = !bs.value; };
      bs.addEventListener('change', fill); fill();
      box.querySelector('#mc-go').addEventListener('click', () => { const b = bs.value, s = ss.value; closeModal(); pick(b ? { b, s: s || null } : { top: true }); });
    });
  }

  // NOTEBOOK | THE VAULT | BULLET JOURNAL
  function applySec() {
    const app = root.querySelector('.nt-app');
    if (!app) return;
    app.classList.remove('sec-notebook', 'sec-vault', 'sec-bujo'); app.classList.add(`sec-${S.sec}`);
    $$('#nt-sec button').forEach((b) => b.classList.toggle('on', b.dataset.sec === S.sec));
    $('.nt-cols').classList.toggle('hidden', S.sec === 'bujo');
    const bj = $('#nt-bujo');
    bj.classList.toggle('hidden', S.sec !== 'bujo');
    if (S.sec === 'bujo' && !bj.dataset.mounted) {
      bj.dataset.mounted = '1';
      if (window.hsBujo?.mount) window.hsBujo.mount(bj); else bj.innerHTML = '<div class="nt-empty">The bullet journal did not load.</div>';
    }
  }
  async function setSec(sec) {
    if (sec === S.sec) return;
    await flush();
    S.sec = sec; pref.set({ sec });
    S.book = 'all'; S.section = null; S.q = ''; S.hits = null; S.cur = null; S.adding = null;
    if ($('#nt-q')) $('#nt-q').value = '';
    applySec();
    if (sec === 'bujo') return;
    renderBooks(); renderList(); renderEditor();
    if (sec === 'vault' && !S.state?.unlocked) journalPrompt();
  }
  // the line between the notebook list (above) and the page list (below): drag it, the ratio is remembered
  const SPLIT_KEY = 'hs-notes-split';
  function applySplit(h) {
    const side = $('.nt-side'), b = $('#nt-books');
    if (!side || !b) return;
    const r = h != null ? h / side.clientHeight : parseFloat(localStorage.getItem(SPLIT_KEY));
    if (!(r > 0.05 && r < 0.9)) { b.style.height = ''; b.style.maxHeight = ''; return; }
    b.style.maxHeight = 'none'; b.style.height = `${Math.round(r * side.clientHeight)}px`;
  }
  function wireSplit() {
    const bar = $('#nt-split'), side = $('.nt-side');
    applySplit();
    window.addEventListener('resize', () => applySplit());
    bar.addEventListener('dblclick', () => { localStorage.removeItem(SPLIT_KEY); applySplit(); });
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { bar.setPointerCapture(e.pointerId); } catch {} bar.classList.add('drag');
      const top = $('#nt-books').getBoundingClientRect().top;
      const move = (ev) => { const h = Math.max(50, Math.min(side.clientHeight - 170, ev.clientY - top)); applySplit(h); };
      const up = () => {
        bar.classList.remove('drag'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
        try { localStorage.setItem(SPLIT_KEY, String($('#nt-books').offsetHeight / side.clientHeight)); } catch {}
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
  }

  const isSectionPdf = (n) => (/: whole section \(PDF\)$/.test(n.title || '') ? 1 : 0);
  function visible() {
    let l = pool().filter((n) => (S.book === 'trash' ? n.deleted : !n.deleted));
    if (S.book === 'journal') l = l.filter((n) => n.journal);
    else if (!['all', 'trash'].includes(S.book)) l = l.filter((n) => n.notebook === S.book && (!S.section || n.section === S.section));
    if (S.hits) l = l.filter((n) => S.hits.has(n.id));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    if (S.filter === 'files') l = l.filter((n) => n.pics > 0);
    else if (S.filter === 'todos') l = l.filter((n) => n.todos > 0);
    else if (S.filter === 'today') l = l.filter((n) => new Date(n.updated) >= day);
    else if (S.filter === 'week') l = l.filter((n) => Date.now() - new Date(n.updated) < 7 * 864e5);
    if (S.sort === 'manual') {
      const ix = new Map((ORD.get()[scopeKey()] || []).map((id, i) => [id, i])), at = (n) => (ix.has(n.id) ? ix.get(n.id) : -1); // pages you haven't placed yet go on top
      return l.sort((a, b) => (isSectionPdf(a) - isSectionPdf(b)) || (at(a) - at(b)) || String(b.updated).localeCompare(String(a.updated)));
    }
    const [by, dir] = S.sort.split('-'), sign = dir === 'new' || dir === 'za' ? -1 : 1;
    const key = (n) => (by === 'title' ? String(n.title || 'Untitled').toLowerCase() : String(by === 'created' ? n.created : n.updated));
    // the OneNote import's "whole section (PDF)" pages are only a backup picture of each section: they always go last
    return l.sort((a, b) => (isSectionPdf(a) - isSectionPdf(b)) || sign * key(a).localeCompare(key(b), undefined, { numeric: true }));
  }
  function renderList() {
    const l = visible();
    let pdfHead = false;
    const locked = S.sec === 'vault' && !S.state?.unlocked && S.state?.lockedJournal;
    const banner = locked ? `<div class="nt-lockbanner">🔒 <b>${S.state.lockedJournal}</b> ${S.state.lockedJournal === 1 ? 'page is' : 'pages are'} locked in THE VAULT. <button id="nt-banner-unlock">UNLOCK</button></div>` : '';
    $('#nt-list').innerHTML = banner + (l.length ? l.slice(0, 400).map((n) => {
      const pdf = isSectionPdf(n);
      const head = pdf && !pdfHead && l.length > 1 ? ((pdfHead = true), '<div class="nt-lhead">SECTION PDFS · BACKUP PICTURES FROM ONENOTE</div>') : '';
      const where = S.book === 'all' || S.q ? ` · ${esc(n.notebook || '')}` : !S.section && n.section ? ` · ${esc(n.section)}` : '';
      const date = S.sort.startsWith('created') ? `new ${when(n.created)}` : when(n.updated);
      return `${head}<div class="nt-p ${pdf ? 'pdf' : ''} ${S.cur?.id === n.id ? 'on' : ''}" data-id="${n.id}" draggable="${S.book !== 'trash'}" tabindex="0">
        <b>${pdf ? `📄 ${esc((n.title || '').replace(/: whole section \(PDF\)$/, ''))} · section PDF` : esc(n.title || 'Untitled')}</b><span>${date}${where}${n.pics ? ` · ${n.pics} 📎` : ''}${n.todos ? ` · ${n.todos} ☐` : ''}</span>
        ${pdf ? '' : `<p>${esc(n.preview)}</p>`}</div>`;
    }).join('') : `<div class="nt-empty">${S.q ? 'Nothing matches your search.' : S.filter !== 'all' ? 'No pages match this filter. Choose “ALL PAGES”.' : S.book === 'trash' ? 'Trash is empty.' : 'No pages here yet.<br>Press <b>+ NEW PAGE</b> to write one.'}</div>`);
    $('#nt-banner-unlock')?.addEventListener('click', () => journalPrompt());
    const clearMarks = () => $$('#nt-list .drop-before, #nt-list .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    $$('#nt-list .nt-p').forEach((el) => {
      el.addEventListener('click', () => openNote(el.dataset.id));
      el.addEventListener('contextmenu', (e) => pageMenu(e, el.dataset.id));
      el.addEventListener('keydown', (e) => { if (e.key === 'Delete') { e.preventDefault(); removePage(el.dataset.id); } else if (e.key === 'Enter') openNote(el.dataset.id); });
      el.addEventListener('dragstart', (e) => { S.dragId = el.dataset.id; e.dataTransfer.setData('text/hs-note', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; root.classList.add('nt-dragging'); });
      el.addEventListener('dragend', () => { S.dragId = null; clearMarks(); root.classList.remove('nt-dragging'); });
      el.addEventListener('dragover', (e) => {
        if (!S.dragId || S.dragId === el.dataset.id || S.book === 'trash') return;
        e.preventDefault(); clearMarks();
        const r = el.getBoundingClientRect();
        el.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
      el.addEventListener('drop', (e) => {
        if (!S.dragId || S.book === 'trash') return;
        e.preventDefault(); e.stopPropagation();
        const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, id = S.dragId;
        clearMarks(); reorder(id, el.dataset.id, after);
      });
    });
    const lst = $('#nt-list');
    lst.ondragover = (e) => { if (S.dragId && !e.target.closest('.nt-p') && S.book !== 'trash') e.preventDefault(); };
    lst.ondrop = (e) => { if (S.dragId && !e.target.closest('.nt-p') && S.book !== 'trash') { e.preventDefault(); reorder(S.dragId, null, true); } }; // dropped below the last page
    renderWhere();
    const c = $('#nt-count'); if (c) c.textContent = ` ${l.length} ${l.length === 1 ? 'page' : 'pages'}`;
  }

  // drag a page to a new spot in the list; the list switches to MY ORDER by itself
  // fire a twr event (mascot); never throws
  const twr = (detail) => { try { document.dispatchEvent(new CustomEvent('twr', { detail })); } catch {} };
  // tow: remember where an element was, re-render, then ask the rabbit to tow the new node from there to its new spot
  const towFrom = (el) => { try { return el ? el.getBoundingClientRect() : null; } catch { return null; } };
  const towTo = (from, el) => { try { if (!from || !el) return; const to = el.getBoundingClientRect(); if (Math.hypot(to.left - from.left, to.top - from.top) < 8) return; twr({ do: 'tow', el, from, to }); } catch {} };
  const pageEl = (id) => { try { return [...document.querySelectorAll('#nt-list .nt-p')].find((e) => e.dataset.id === id) || null; } catch { return null; } };
  function reorder(id, refId, after) {
    if (S.q || S.filter !== 'all') return toast('CLEAR THE SEARCH AND FILTER FIRST, THEN DRAG', true);
    const from = towFrom(pageEl(id));
    const ids = visible().map((n) => n.id).filter((x) => x !== id);
    let k = refId ? ids.indexOf(refId) : ids.length;
    if (k < 0) k = ids.length; else if (after && refId) k++;
    ids.splice(k, 0, id);
    ORD.set(scopeKey(), ids);
    if (S.sort !== 'manual') { S.sort = 'manual'; pref.set({ sort: 'manual' }); if ($('#nt-sort')) $('#nt-sort').value = 'manual'; toast('SORT SET TO “MY ORDER”: DRAG PAGES ANYWHERE'); }
    renderList(); towTo(from, pageEl(id));
  }
  const moveTo = (id, where) => { // 'top' | 'bottom'
    if (S.q || S.filter !== 'all') return toast('CLEAR THE SEARCH AND FILTER FIRST', true);
    const ids = visible().map((n) => n.id).filter((x) => x !== id);
    const from = towFrom(pageEl(id));
    ORD.set(scopeKey(), where === 'top' ? [id, ...ids] : [...ids, id]);
    if (S.sort !== 'manual') { S.sort = 'manual'; pref.set({ sort: 'manual' }); if ($('#nt-sort')) $('#nt-sort').value = 'manual'; }
    renderList(); towTo(from, pageEl(id));
  };
  async function trashPage(id) {
    await flush();
    if (S.cur?.id === id) { S.cur = null; S.dirty = false; renderEditor(); }
    await call('notesDelete', id); twr({ do: 'react', name: 'deleted' }); toast('MOVED TO TRASH · RESTORE IT FROM THE TRASH FOLDER');
    await loadList();
  }
  async function removePage(id) {
    const n = S.list.find((x) => x.id === id);
    if (!n) return;
    if (n.deleted) { if (!confirm('Delete this page forever? It also disappears from the SSD and server copies.')) return; if (S.cur?.id === id) { S.cur = null; renderEditor(); } await call('notesDelete', id, true); return loadList(); }
    return trashPage(id);
  }
  function pageMenu(e, id) {
    const n = S.list.find((x) => x.id === id);
    if (!n) return;
    const title = n.title || 'Untitled';
    if (n.deleted) return hsMenu(e, [
      { label: 'Restore', run: async () => { await call('notesRestore', id); toast('RESTORED'); loadList(); } },
      { label: 'Delete forever', danger: true, run: () => removePage(id) },
    ], title);
    hsMenu(e, [
      { label: 'Open', run: () => openNote(id) },
      { label: 'Rename', run: async () => { await openNote(id); const t = $('#nt-title'); t?.focus(); t?.select(); } },
      { label: 'Move to…', run: () => moveDialog(`“${title}”`, {}, (d) => dropPage(id, d.s ? 'sec' : 'book', d.b, d.s || '')) },
      { label: 'Move / lock options…', run: async () => { await openNote(id); if (S.cur) move(S.cur); } },
      { label: 'Earlier versions…', run: async () => { await openNote(id); if (S.cur) history(S.cur); } },
      '-',
      { label: 'Move to top of list', run: () => moveTo(id, 'top') },
      { label: 'Move to bottom of list', run: () => moveTo(id, 'bottom') },
      { label: 'Save as template…', run: async () => { await openNote(id); await flush(); if (S.cur) saveTemplate(S.cur); } },
      { label: 'Copy title', run: () => { navigator.clipboard.writeText(title).catch(() => {}); twr({ do: 'react', name: 'copied' }); } },
      '-',
      { label: 'Delete (to trash)', danger: true, run: () => removePage(id) },
    ], title);
  }
  // a notebook, a section or the trash, right-clicked in the tree
  function bookMenu(e, b, s) {
    if (b === 'all' || b === 'journal') return hsMenu(e, [{ label: 'New page', run: () => newNote() }], b === 'all' ? 'ALL NOTES' : 'LOCKED PAGES');
    if (b === 'trash') {
      const gone = S.list.filter((n) => n.deleted);
      return hsMenu(e, [{ label: `Restore everything (${gone.length})`, off: !gone.length, run: async () => { for (const n of gone) await call('notesRestore', n.id); toast('RESTORED'); loadList(); } },
        { label: 'Empty the trash forever', danger: true, off: !gone.length, run: async () => { if (!confirm(`Delete ${gone.length} pages forever? They also disappear from the SSD and server copies.`)) return; for (const n of gone) await call('notesDelete', n.id, true); S.cur = null; renderEditor(); loadList(); } }], 'TRASH');
    }
    const pages = S.list.filter((n) => !n.deleted && n.notebook === b && (!s || n.section === s));
    const locked = !S.state?.unlocked && lockedNow(b, s);
    hsMenu(e, [
      { label: 'Open', run: () => $$('#nt-books .nt-b').find((x) => x.dataset.book === b && (x.dataset.sec || null) === s)?.click() },
      locked ? { label: 'Unlock the journal…', run: () => { S.book = b; S.section = s; renderBooks(); renderList(); journalPrompt(); } } : { label: 'New page here', run: async () => { S.book = b; S.section = s; await newNote(); } },
      { label: 'Move to…', off: locked, run: () => moveDialog(`“${s || b}”`, { top: !!s, skipBook: s ? null : b }, (d) => moveContainer({ b, s }, d)) },
      s ? null : { label: 'New section in this notebook', off: locked, run: async () => { S.book = b; S.section = null; await flush(); S.adding = 'sec'; renderBooks(); } },
      '-',
      { label: s ? 'Rename section…' : 'Rename notebook…', off: locked, run: () => renameContainer(b, s) },
      { label: `Delete ${s ? 'section' : 'notebook'} (${pages.length} ${pages.length === 1 ? 'page' : 'pages'} to trash)`, danger: true, off: locked || !pages.length, run: async () => {
        if (!confirm(`Move all ${pages.length} pages in “${s || b}” to the trash? You can restore them from the trash.`)) return;
        await flush(); S.cur = null; for (const n of pages) await call('notesDelete', n.id);
        if (S.book === b) { S.book = 'all'; S.section = null; }
        toast(`${(s || b).toUpperCase()} MOVED TO TRASH`); renderEditor(); loadList();
      } },
    ].filter(Boolean), s ? `${b} › ${s}` : b);
  }
  function renameContainer(b, s) {
    modal(`<h3>Rename ${s ? 'section' : 'notebook'}</h3><input id="rn-v" maxlength="60" value="${esc(s || b)}"><button class="nt-go" id="rn-go">RENAME</button>`, (box) => {
      const inp = box.querySelector('#rn-v'); inp.focus(); inp.select();
      const go = async () => {
        const v = inp.value.trim();
        if (!v || v === (s || b)) return closeModal();
        await flush(); closeModal(); toast('RENAMING…');
        for (const m of S.list.filter((n) => n.notebook === b && (!s || n.section === s))) {
          const n = await call('notesGet', m.id); if (!n) continue;
          await call('notesSave', { id: n.id, title: n.title, body: n.body, blobs: n.blobs, notebook: s ? n.notebook : v, section: s ? v : n.section, journal: n.journal, jm: n.jm, keepDates: true, updated: n.updated });
        }
        if (S.book === b) { if (s) S.section = v; else S.book = v; }
        S.cur = null; renderEditor(); loadList();
      };
      box.querySelector('#rn-go').addEventListener('click', go);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  // ---------------- one page ----------------
  // S.cur is THE page on screen, and it is never swapped for a copy: typing changes it in place, saving only adds
  // what the vault decides (dates). (The old code swapped it after each save, so later typing went into a stale copy.)
  async function openNote(id) {
    if (S.cur?.id === id) { $('#nt-body')?.focus(); return; }
    const tok = ++S.tok;
    const prevId = S.cur?.id;
    await flush(); await dropIfEmpty();
    // usage log lives in the main process (the side dock is another window); fall back to local storage if that call fails
    hs.call('notesUse', id).catch(() => { try { const u = JSON.parse(localStorage.getItem('hs-notes-use') || '{}'); (u[id] = (u[id] || []).filter((t) => Date.now() - t < 36 * 36e5)).push(Date.now()); localStorage.setItem('hs-notes-use', JSON.stringify(u)); } catch {} });
    const n = await call('notesGet', id);
    if (!n || tok !== S.tok) return;
    if (prevId && prevId !== id && !S.noHist) { S.hist.push(prevId); if (S.hist.length > 50) S.hist.shift(); }
    S.noHist = false;
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
  // nothing open: a start page with your latest pages, not a blank prompt
  function emptyHTML() {
    const recent = S.list.filter((n) => !n.deleted && !isSectionPdf(n)).sort((x, y) => String(y.updated).localeCompare(String(x.updated))).slice(0, 8);
    const locked = !S.state?.unlocked && S.state?.lockedJournal;
    return `<div class="nt-empty big nt-start"><h2>Your notes</h2>
      <div class="nt-startbtns"><button class="nt-go" id="nt-empty-new">+ NEW PAGE</button>${locked ? `<button class="nt-go ghost" id="nt-empty-unlock">🔒 UNLOCK ${S.state.lockedJournal} HIDDEN ${S.state.lockedJournal === 1 ? 'PAGE' : 'PAGES'}</button>` : ''}</div>
      ${recent.length ? `<div class="nt-bhead">RECENT</div><div class="nt-recent">${recent.map((n) => `<button data-open="${n.id}"><b>${esc(n.title || 'Untitled')}</b><span>${when(n.updated)} · ${esc(n.notebook || 'Notes')}${n.section ? ' › ' + esc(n.section) : ''}</span></button>`).join('')}</div>` : '<p class="dim">No pages yet. Press <b>+ NEW PAGE</b>, or import your OneNote from the VAULT &amp; TOOLS bar.</p>'}
      <p class="dim">Everything you type is saved by itself and encrypted.</p></div>`;
  }
  function renderEditor() {
    const n = S.cur, ed = $('#nt-edit');
    if (!ed) return;
    if (!n) {
      ed.innerHTML = emptyHTML();
      $('#nt-empty-new')?.addEventListener('click', () => newNote());
      $('#nt-empty-unlock')?.addEventListener('click', () => journalPrompt());
      ed.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openNote(b.dataset.open)));
      return;
    }
    const gone = !!n.deleted, tool = (f, label, title) => `<button data-f="${f}" title="${title}">${label}</button>`;
    ed.innerHTML = `
      <div class="nt-ehead">
        <div class="nt-path"><em id="nt-path"></em></div>
        <input class="nt-title" id="nt-title" value="${esc(n.title || '')}" placeholder="Page title…" ${gone ? 'disabled' : ''} maxlength="200">
        <div class="nt-meta"><span>created ${when(n.created)} · edited ${when(n.updated)}</span><span id="nt-saved" class="nt-saved"></span></div>
        <div class="nt-tools">
          ${gone ? '<button class="act" id="nt-restore">RESTORE</button><button class="act danger" id="nt-forever">DELETE FOREVER</button>' : `
          ${fmtBar(tool)}
          <button class="act ${S.preview ? 'on' : ''}" id="nt-prev" title="See the finished page instead of the text. Press again to go back to writing.">${S.preview ? 'EDIT' : 'VIEW'}</button>
          <span class="grow"></span><button class="act" id="nt-move">MOVE</button><button class="act" id="nt-hist">HISTORY</button><button class="act danger" id="nt-del">DELETE</button>`}
        </div>
      </div>
      <div class="nt-work ${S.preview && !gone ? 'viewing' : ''} ${gone ? 'only-read' : ''}">
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
    // Tab (or Enter) in the title jumps straight into the page text
    $('#nt-title')?.addEventListener('keydown', (e) => { if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') { e.preventDefault(); const t = $('#nt-body'); if (t) { t.focus(); t.setSelectionRange(0, 0); } } });
    ta?.addEventListener('input', () => { S.cur.body = ta.value; changed(); });
    ta?.addEventListener('paste', async (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); await addFiles(files); }
    });
    ta?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('SAVED')); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); format(e.key.toLowerCase()); return; }
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
    $$('#nt-edit [data-sel]').forEach((x) => x.addEventListener('change', () => { if (x.value) format(x.dataset.sel === 's' ? 'size' : 'f', x.value); x.value = ''; }));
    $$('#nt-edit [data-col]').forEach((x) => x.addEventListener('change', () => format(x.dataset.col, x.value)));
    // right-click inside the page: edit commands plus the common formatting
    ta?.addEventListener('contextmenu', (e) => {
      const has = ta.selectionStart !== ta.selectionEnd;
      hsMenu(e, [
        { label: 'Undo', run: () => format('undo') }, { label: 'Redo', run: () => format('redo') }, '-',
        { label: 'Cut', off: !has, run: () => { ta.focus(); document.execCommand('cut'); } },
        { label: 'Copy', off: !has, run: () => { ta.focus(); document.execCommand('copy'); } },
        { label: 'Paste', run: async () => { try { ta.focus(); document.execCommand('insertText', false, await navigator.clipboard.readText()); } catch {} } },
        { label: 'Select all', run: () => { ta.focus(); ta.select(); } }, '-',
        { label: 'Bold', run: () => format('b') }, { label: 'Italic', run: () => format('i') }, { label: 'Underline', run: () => format('u') },
        { label: 'Heading', run: () => format('h2') }, { label: 'Bulleted list', run: () => format('li') }, { label: 'To-do', run: () => format('box') },
        { label: 'Make a link', run: () => format('link') }, { label: 'Clear formatting', off: !has, run: () => format('clear') }, '-',
        { label: 'Add a picture…', run: () => format('pic') }, { label: 'Attach a file…', run: () => $('#nt-files').click() },
      ]);
    });
    $('#nt-prev')?.addEventListener('click', () => { S.preview = !S.preview; const keep = $('#nt-body')?.selectionStart; renderEditor(); const t = $('#nt-body'); if (t) { t.focus(); if (keep != null) t.setSelectionRange(keep, keep); } });
    $('#nt-file').addEventListener('change', (e) => { if (e.target.files[0]) addPicture(e.target.files[0]); e.target.value = ''; });
    $('#nt-files').addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
    $('#nt-attach')?.addEventListener('click', () => $('#nt-files').click());
    $('#nt-del')?.addEventListener('click', () => trashPage(S.cur.id));
    $('#nt-restore')?.addEventListener('click', async () => { const id = S.cur.id; await call('notesRestore', id); toast('RESTORED'); S.cur = null; renderEditor(); loadList(); });
    $('#nt-forever')?.addEventListener('click', async () => { if (!confirm('Delete this page forever? It also disappears from the SSD and server copies.')) return; const id = S.cur.id; S.cur = null; await call('notesDelete', id, true); renderEditor(); loadList(); });
    $('#nt-hist')?.addEventListener('click', () => history(S.cur));
    $('#nt-move')?.addEventListener('click', () => move(S.cur));
  }
  // the Word-style rows above a page. Everything is plain text underneath (markdown plus a few {c:#hex|text}-style tags),
  // so pages stay small, searchable and encrypted like before.
  const FONT_OPTS = [['', 'FONT'], ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Handwriting'], ['display', 'Display']];
  const SIZE_OPTS = [['', 'SIZE'], ['12', 'Small'], ['16', 'Medium'], ['20', 'Large'], ['28', 'Huge'], ['40', 'Giant']];
  function fmtBar(tool) {
    const sel = (k, o, t) => `<select data-sel="${k}" title="${t}">${o.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    return `
      <span class="nt-fmt">${tool('undo', '↶ UNDO', 'Undo the last change (Ctrl+Z)')}${tool('redo', '↷ REDO', 'Redo (Ctrl+Y)')}<button data-f="back" title="Go back to the page you were on before" ${S.hist.length ? '' : 'disabled'}>‹ BACK</button></span>
      <span class="nt-fmt">${sel('f', FONT_OPTS, 'Font for the selected text')}${sel('s', SIZE_OPTS, 'Text size for the selected text')}<label class="nt-col" title="Text colour (select text first)">A<input type="color" data-col="c" value="#00ff6e"></label><label class="nt-col hl" title="Highlight colour (select text first)">▮<input type="color" data-col="h" value="#ffc400"></label></span>
      <span class="nt-fmt">${tool('b', '<b>B</b>', 'Bold (Ctrl+B)')}${tool('i', '<i>I</i>', 'Italic (Ctrl+I)')}${tool('u', '<u>U</u>', 'Underline (Ctrl+U)')}${tool('s', '<s>S</s>', 'Strikethrough')}${tool('hl', '▮ MARK', 'Highlight')}${tool('code', '&lt;/&gt;', 'Code')}${tool('clear', '✕ CLEAR', 'Remove the formatting from the selected text')}</span>
      <span class="nt-fmt">${tool('h1', 'H1', 'Big heading')}${tool('h2', 'H2', 'Heading')}${tool('h3', 'H3', 'Small heading')}${tool('li', '• LIST', 'Bulleted list')}${tool('ol', '1. LIST', 'Numbered list')}${tool('box', '☐ TO-DO', 'To-do you can tick')}${tool('quote', '❝ QUOTE', 'Quote')}</span>
      <span class="nt-fmt">${tool('left', '⇤', 'Align left')}${tool('center', '↔', 'Centre')}${tool('right', '⇥', 'Align right')}${tool('outdent', '⇠ OUT', 'Less indent')}${tool('indent', 'IN ⇢', 'More indent')}</span>
      <span class="nt-fmt">${tool('link', '🔗 LINK', 'Make the selected text a link')}${tool('table', '▦ TABLE', 'Insert a table')}${tool('hr', '― LINE', 'Divider line')}${tool('date', '📅 DATE', 'Insert today\'s date and time')}${tool('pic', '🖼 PICTURE', 'Add a picture')}<button id="nt-attach" title="Attach any file: PDF, Word, audio… (or drag files onto the page)">📎 FILE</button></span>`;
  }
  const showPath = () => { const n = S.cur, el = $('#nt-path'); if (n && el) el.textContent = [n.notebook || 'Notes', n.section, n.title || 'Untitled'].filter(Boolean).join(' › '); };
  let prevT;
  function renderPreview() {
    const read = $('#nt-read'), n = S.cur;
    if (!read || !n || !(S.preview || n.deleted)) return;
    read.innerHTML = md(n.body) || '<p class="dim">This page is empty.</p>';
    fillBlobs(read);
  }
  async function goBack() {
    const id = S.hist.pop();
    if (!id) return;
    S.noHist = true; await openNote(id); S.noHist = false;
    if (!S.list.some((x) => x.id === id)) toast('THAT PAGE IS GONE', true);
  }
  function format(f, val) {
    const ta = $('#nt-body');
    if (f === 'back') return goBack();
    if (!ta) return;
    if (f === 'pic') return $('#nt-file').click();
    const sync = () => { S.cur.body = ta.value; changed(); };
    if (f === 'undo' || f === 'redo') { ta.focus(); document.execCommand(f); return; } // the textarea's own history; its input event does the saving
    // wrap the selected text (or a placeholder) and keep the inside selected so you can type over it
    const wrap = (pre, post, ph = 'text') => {
      const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b) || ph;
      ta.focus(); ta.setSelectionRange(a, b);
      document.execCommand('insertText', false, pre + sel + post);
      ta.setSelectionRange(a + pre.length, a + pre.length + sel.length); sync();
    };
    // change every line the selection touches
    const lines = (fn) => {
      const a = ta.selectionStart, b = ta.selectionEnd, ls = ta.value.lastIndexOf('\n', a - 1) + 1;
      let le = ta.value.indexOf('\n', b); if (le < 0) le = ta.value.length;
      const out = ta.value.slice(ls, le).split('\n').map(fn).join('\n');
      ta.focus(); ta.setSelectionRange(ls, le); document.execCommand('insertText', false, out); ta.setSelectionRange(ls, ls + out.length); sync();
    };
    const put = (txt) => { ta.focus(); document.execCommand('insertText', false, txt); sync(); };
    const prefix = (re, pre) => (l) => (re.test(l) && l.startsWith(pre) ? l.replace(re, '') : pre + l.replace(re, ''));
    switch (f) {
      case 'b': return wrap('**', '**');
      case 'i': return wrap('*', '*');
      case 'u': return wrap('++', '++');
      case 's': return wrap('~~', '~~');
      case 'hl': return wrap('==', '==');
      case 'code': return /\n/.test(ta.value.slice(ta.selectionStart, ta.selectionEnd)) ? wrap('```\n', '\n```', 'code') : wrap('`', '`', 'code');
      case 'c': case 'h': case 's:': return wrap(`{${f}:${val}|`, '}');
      case 'f': case 'size': return wrap(`{${f === 'f' ? 'f' : 's'}:${val}|`, '}');
      case 'h': return lines((l) => '## ' + l.replace(/^#{1,4}\s*/, ''));
      case 'h1': return lines(prefix(/^#{1,4}\s*/, '# '));
      case 'h2': return lines(prefix(/^#{1,4}\s*/, '## '));
      case 'h3': return lines(prefix(/^#{1,4}\s*/, '### '));
      case 'li': return lines(prefix(/^\s*([-*]|\d+\.)\s(\[[ xX]\]\s)?/, '- '));
      case 'box': return lines(prefix(/^\s*([-*]|\d+\.)\s(\[[ xX]\]\s)?/, '- [ ] '));
      case 'ol': { let k = 0; return lines((l) => `${++k}. ${l.replace(/^\s*([-*]|\d+\.)\s(\[[ xX]\]\s)?/, '')}`); }
      case 'quote': return lines(prefix(/^>\s?/, '> '));
      case 'indent': return lines((l) => `  ${l}`);
      case 'outdent': return lines((l) => l.replace(/^ {1,2}/, ''));
      case 'left': case 'center': case 'right': return lines((l) => { if (!l.trim()) return l; const inner = l.replace(/^\{a:(left|center|right)\|(.*)\}$/, '$2'); return f === 'left' ? inner : `{a:${f}|${inner}}`; });
      case 'link': return wrap('[', '](https://)', 'link text');
      case 'table': return put('\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n');
      case 'hr': return put('\n---\n');
      case 'date': return put(new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
      case 'clear': {
        const a = ta.selectionStart, b = ta.selectionEnd;
        if (a === b) return toast('SELECT SOME TEXT FIRST');
        const out = ta.value.slice(a, b).replace(/\{[cshfa]:[^|{}]{1,20}\|([^{}]*)\}/g, '$1').replace(/\*\*|~~|\+\+|==|`/g, '').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
        ta.focus(); document.execCommand('insertText', false, out); ta.setSelectionRange(a, a + out.length); return sync();
      }
    }
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
    const snap = { id: n.id, title: n.title, body: n.body, blobs: n.blobs, notebook: n.notebook, section: n.section, journal: n.journal, jm: n.jm };
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
    try { if (Date.now() - (S.lastSavedFx || 0) > 20000) { S.lastSavedFx = Date.now(); twr({ do: 'react', name: 'saved' }); } } catch {} // at most once per 20 s
    const meta = metaOf({ ...saved, title: snap.title, body: snap.body, blobs: snap.blobs });
    const k = S.list.findIndex((x) => x.id === saved.id);
    if (k >= 0) S.list[k] = meta; else S.list.push(meta);
    renderList();
  }
  // a new page opens ready to type: in the title, or in the text for the first page of a new notebook / section
  async function newNote(o = {}) {
    if ((S.book === 'journal' || S.sec === 'vault') && !o.title) return newJournal();
    await flush(); await dropIfEmpty();
    const book = !['all', 'journal', 'trash'].includes(S.book) ? S.book : 'Notes';
    S.q = ''; S.hits = null; S.filter = 'all'; if ($('#nt-q')) $('#nt-q').value = ''; if ($('#nt-filter')) $('#nt-filter').value = 'all';
    const n = await call('notesSave', { title: o.title || '', body: o.body || '', notebook: book, section: S.section || '' }).catch((e) => { toast(`COULDN'T START A PAGE: ${String(e.message).replace(/^Error invoking remote method 'api': (Error: )?/, '')}`, true); return null; });
    if (!n) return;
    S.cur = n; S.dirty = false; S.fresh = n.id; S.tok++;
    if (!S.list.some((x) => x.id === n.id)) S.list.push(metaOf(n));
    renderBooks(); renderList(); renderEditor();
    (o.start === 'body' || o.title ? $('#nt-body') : $('#nt-title'))?.focus();
  }
  async function newJournal(date) {
    await flush(); await dropIfEmpty();
    if (S.sec !== 'vault') { S.sec = 'vault'; pref.set({ sec: 'vault' }); applySec(); }
    if (!S.state.unlocked) { S.book = 'journal'; S.section = null; renderBooks(); renderList(); return journalPrompt(newJournal); }
    const d = date instanceof Date ? date : new Date();
    // a journal entry goes in a locked section called Journal, inside the notebook you're in (or Notes)
    const book = !['all', 'journal', 'trash'].includes(S.book) ? S.book : 'Notes';
    S.q = ''; S.hits = null;
    const n = await call('notesSave', { title: d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), body: '', notebook: book, section: 'Journal', journal: true });
    S.cur = n; S.dirty = false; S.book = book; S.section = 'Journal'; S.tok++;
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
        Object.assign(S.cur, { notebook: box.querySelector('#mv-b').value.trim() || 'Notes', section: box.querySelector('#mv-s').value.trim(), journal: box.querySelector('#mv-j').checked, jm: box.querySelector('#mv-j').checked });
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
      <label>Spell check</label><label class="nt-tick"><input type="checkbox" id="vs-spell" ${window.hsSpell?.enabled() === false ? '' : 'checked'}> underline misspelled words in notes and offer corrections when you right-click them</label>
      <label>Change master password</label><input type="password" id="vs-old" placeholder="current password (or recovery key)"><input type="password" id="vs-new" placeholder="new password (10+ characters)"><input type="password" id="vs-new2" placeholder="new password again">
      <button class="nt-go" id="vs-pw">CHANGE PASSWORD</button>
      <p class="dim">The main copy lives in ${esc(s.dir)}.</p>`, (box) => {
      const setM = async (list) => { await call('notesMirrors', list); closeModal(); vaultSettings(); };
      box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => setM(s.mirrors.filter((_, k) => k !== +b.dataset.rm).map((m) => m.dir))));
      box.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => setM([...s.mirrors.map((m) => m.dir), b.dataset.add])));
      box.querySelector('#vs-pick').addEventListener('click', async () => { const d = await call('routerPickFolder', 'Choose a folder for a copy of your notes'); if (d) setM([...s.mirrors.map((m) => m.dir), d.endsWith('HYPERSPACE Notes') ? d : `${d.replace(/[\\/]$/, '')}\\HYPERSPACE Notes`]); });
      box.querySelector('#vs-sync').addEventListener('click', async () => { toast('SYNCING COPIES…'); await call('notesSyncNow'); closeModal(); vaultSettings(); });
      box.querySelector('#vs-spell').addEventListener('change', (e) => window.hsSpell?.set(e.target.checked));
      box.querySelector('#vs-min').addEventListener('change', (e) => call('notesAutoLock', +e.target.value));
      box.querySelector('#vs-pw').addEventListener('click', async () => {
        const o = box.querySelector('#vs-old').value, a = box.querySelector('#vs-new').value, b = box.querySelector('#vs-new2').value;
        if (a.length < 10) return toast('USE AT LEAST 10 CHARACTERS', true);
        if (a !== b) return toast("THE NEW PASSWORDS DON'T MATCH", true);
        try { await call('notesPassword', o, a); toast('PASSWORD CHANGED · THE COPIES UPDATE ON THEIR NEXT SYNC'); closeModal(); } catch (e) { toast(e.message.toUpperCase(), true); }
      });
    });
  }

  // ---------------- journal calendar ----------------
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function parseJDate(title) {
    let t = String(title || '').trim().replace(/\s+/g, ' ').replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
    t = t.replace(/[,\s]+(?:at\s+)?\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?$/i, '').replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?$/i, '');
    let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (m) return new Date(+m[1], m[2] - 1, +m[3]);
    m = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})$/);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], a = +m[1], b = +m[2]; return a > 12 ? new Date(y, b - 1, a) : new Date(y, a - 1, b); }
    const d = new Date(t.replace(/(\d)(?:st|nd|rd|th)\b/i, '$1').replace(/\bof\b/i, ''));
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function journalDays() {
    const days = new Map();
    for (const n of S.list) { if (!n.journal || n.deleted) continue; const d = parseJDate(n.title); if (d && d.getFullYear() > 1970 && !days.has(ymd(d))) days.set(ymd(d), n.id); }
    return days;
  }
  function streaks(days) {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    let cur = 0; const c = new Date(day);
    if (!days.has(ymd(c))) c.setDate(c.getDate() - 1);
    while (days.has(ymd(c))) { cur++; c.setDate(c.getDate() - 1); }
    const keys = [...days.keys()].sort(); let best = 0, run = 0, prev = null;
    for (const k of keys) { const d = new Date(k + 'T00:00:00'); run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    return { cur, best };
  }
  function calendar(view) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const v = view || { y: now.getFullYear(), m: now.getMonth() };
    const open = !!S.state?.unlocked, days = open ? journalDays() : new Map(), st = streaks(days);
    const first = new Date(v.y, v.m, 1), lead = (first.getDay() + 6) % 7, dim = new Date(v.y, v.m + 1, 0).getDate();
    const inMonth = [...days.keys()].filter((k) => k.startsWith(`${v.y}-${String(v.m + 1).padStart(2, '0')}-`)).length;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="cal-d off"></span>';
    for (let d = 1; d <= dim; d++) {
      const k = ymd(new Date(v.y, v.m, d)), has = days.has(k);
      cells += `<button class="cal-d${has ? ' has' : ''}${k === ymd(now) ? ' today' : ''}" data-k="${k}" ${open ? '' : 'disabled'}>${d}${has ? '<i></i>' : ''}</button>`;
    }
    modal(`<h3>JOURNAL CALENDAR</h3>
      <div class="cal-nav"><button class="act" id="cal-py" title="Previous year">«</button><button class="act" id="cal-pm">‹</button><b>${first.toLocaleDateString([], { month: 'long', year: 'numeric' }).toUpperCase()}</b><button class="act" id="cal-nm">›</button><button class="act" id="cal-ny" title="Next year">»</button><button class="act" id="cal-today">TODAY</button></div>
      <div class="cal-wrap${open ? '' : ' locked'}"><div class="cal-grid">${['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((w) => `<span class="cal-w">${w}</span>`).join('')}${cells}</div>
        ${open ? '' : '<div class="cal-lock"><span>🔒</span><p>The journal is locked.</p><button class="nt-go" id="cal-unlock">UNLOCK</button></div>'}</div>
      <div class="cal-stats"><div><b>${open ? st.cur : '–'}</b><span>DAY STREAK</span></div><div><b>${open ? st.best : '–'}</b><span>BEST STREAK</span></div><div><b>${open ? inMonth : '–'}</b><span>THIS MONTH</span></div><div><b>${open ? days.size : '–'}</b><span>ENTRIES</span></div></div>
      <p class="dim">A glowing dot is a day with an entry. Click a day to open it, or to start that day's entry.</p>`, (box) => {
      const go = (dm, dy) => { const d = new Date(v.y + dy, v.m + dm, 1); calendar({ y: d.getFullYear(), m: d.getMonth() }); };
      box.querySelector('#cal-py').onclick = () => go(0, -1); box.querySelector('#cal-ny').onclick = () => go(0, 1);
      box.querySelector('#cal-pm').onclick = () => go(-1, 0); box.querySelector('#cal-nm').onclick = () => go(1, 0);
      box.querySelector('#cal-today').onclick = () => calendar();
      box.querySelector('#cal-unlock')?.addEventListener('click', () => { closeModal(); journalPrompt(() => calendar(v)); });
      box.querySelectorAll('.cal-d[data-k]').forEach((b) => b.addEventListener('click', () => {
        const id = days.get(b.dataset.k); closeModal();
        if (id) openNote(id); else newJournal(new Date(b.dataset.k + 'T00:00:00'));
      }));
    });
  }

  // ---------------- note templates ----------------
  const TPL_KEY = 'hs-notes-templates';
  const userTpls = () => { try { const a = JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); return Array.isArray(a) ? a.filter((t) => t && t.name) : []; } catch { return []; } };
  const setTpls = (a) => { try { localStorage.setItem(TPL_KEY, JSON.stringify(a)); } catch {} };
  const longDate = () => new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const BUILTIN_TPLS = [
    { name: 'Daily page', body: '# {{date}}\n\n## Top 3 today\n- [ ] \n- [ ] \n- [ ] \n\n## Schedule\n| Time | What |\n| --- | --- |\n|  |  |\n|  |  |\n\n## Notes\n\n\n## Done / gratitude\n' },
    { name: 'DJ set plan', body: '# DJ set plan · {{date}}\n\n**Event:** \n**Venue:** \n**Set time:** \n**Length:** \n\n## Vibe / arc\n\n\n## Tracklist\n| # | Track | Artist | Key | BPM | Notes |\n| --- | --- | --- | --- | --- | --- |\n| 1 |  |  |  |  |  |\n| 2 |  |  |  |  |  |\n| 3 |  |  |  |  |  |\n\n## Must-play\n- [ ] \n\n## After the set\n' },
    { name: 'Gig checklist', body: '# Gig checklist · {{date}}\n\n## Before leaving\n- [ ] USB sticks / crate exported\n- [ ] Laptop + charger\n- [ ] Headphones + spare cable\n- [ ] Controller + power\n- [ ] Visuals loaded\n\n## At the venue\n- [ ] Soundcheck\n- [ ] Levels and booth monitor\n- [ ] Settle the fee\n\n## After\n- [ ] Pack everything\n- [ ] Post the clip\n' },
    { name: 'Meeting notes', body: '# Meeting · {{date}}\n\n**With:** \n**About:** \n\n## Agenda\n- \n\n## Notes\n\n\n## Decisions\n- \n\n## Action items\n- [ ] \n- [ ] \n' },
    { name: 'Track ideas', body: '# Track ideas · {{date}}\n\n## Spark\n\n\n## Details\n| Working title | BPM | Key | Mood |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Elements to try\n- \n\n## To do\n- [ ] Sketch the drop\n- [ ] Bass\n- [ ] Arrangement\n- [ ] Bounce a demo\n' },
    { name: 'Packing list', body: '# Packing list · {{date}}\n\n**Trip:** \n\n## Essentials\n- [ ] Phone + charger\n- [ ] Wallet / ID\n- [ ] Keys\n\n## Clothes\n- [ ] \n\n## Tech / gear\n- [ ] \n\n## Last minute\n- [ ] \n' },
  ];
  async function fromTemplate(t) {
    closeModal();
    const body = String(t.body || '').replace(/\{\{date\}\}/g, longDate());
    await newNote({ title: t.name === 'Daily page' ? longDate() : t.name, body, start: 'body' });
  }
  function templatePicker() {
    const mine = userTpls();
    modal(`<h3>NEW FROM TEMPLATE</h3>
      <div class="nt-bhead">BUILT-IN</div><div class="tpl-grid">${BUILTIN_TPLS.map((t, i) => `<button data-b="${i}">${esc(t.name)}</button>`).join('')}</div>
      <div class="nt-bhead">YOURS</div>${mine.length ? `<div class="tpl-grid">${mine.map((t, i) => `<button data-u="${i}">★ ${esc(t.name)}</button>`).join('')}</div><p class="dim">Right-click one of yours to delete it.</p>` : '<p class="dim">None yet. Right-click a page in the list and choose “Save as template…”.</p>'}`, (box) => {
      box.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => fromTemplate(BUILTIN_TPLS[+b.dataset.b])));
      box.querySelectorAll('[data-u]').forEach((b) => {
        b.addEventListener('click', () => fromTemplate(mine[+b.dataset.u]));
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); hsMenu(e, [{ label: 'Delete template', danger: true, run: () => { const a = userTpls(); a.splice(+b.dataset.u, 1); setTpls(a); toast('TEMPLATE DELETED'); templatePicker(); } }], mine[+b.dataset.u].name); });
      });
    });
  }
  function saveTemplate(n) {
    modal(`<h3>SAVE AS TEMPLATE</h3><label>Template name</label><input id="tp-n" value="${esc(n.title || '')}" maxlength="60"><button class="nt-go" id="tp-go">SAVE TEMPLATE</button>`, (box) => {
      const inp = box.querySelector('#tp-n'); inp.focus(); inp.select();
      const go = () => {
        const name = inp.value.trim(); if (!name) return;
        const a = userTpls().filter((t) => t.name !== name); a.push({ name, body: String(n.body || '') }); setTpls(a);
        closeModal(); toast(`TEMPLATE SAVED · ${name.toUpperCase()}`);
      };
      box.querySelector('#tp-go').addEventListener('click', go);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
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
      if (S.sec === 'vault') journalPrompt();
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
