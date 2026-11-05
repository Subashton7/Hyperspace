// BULLET JOURNAL: a Pinterest-style board of cards (daily log, collection, habit tracker, future log, mood,
// gratitude, sticky quote) in green-on-black Matrix style. Open it with window.hsBujo.mount(element).
// Bullet syntax (type it at the start of a line, it turns into the symbol when you press DONE):
//   . or *  → •  task      x → ×  done      > → >  migrated      o → ○  event      - → –  note
// Click a • / × / > symbol to cycle it. Everything is saved in localStorage ('hs-bujo'); nothing leaves this laptop.
(() => {
  if (typeof hs !== 'undefined' && hs.remote) return;
  const KEY = 'hs-bujo';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const niceDate = (d = new Date()) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

  // ---------- bullet lines ----------
  const ALIAS = [[/^([.•*])\s+/, '•'], [/^[x×]\s+/i, '×'], [/^[>»]\s+/, '>'], [/^[o○]\s+/i, '○'], [/^[-–—]\s+/, '–']];
  function parse(line) {
    for (const [re, sym] of ALIAS) { const m = re.exec(line); if (m) return { s: sym, t: line.slice(m[0].length) }; }
    return line.trim() ? { s: '–', t: line.trim() } : null;
  }
  const normalize = (text) => String(text || '').split('\n').map(parse).filter(Boolean).map((p) => `${p.s} ${p.t}`).join('\n');
  const CYCLE = { '•': '×', '×': '>', '>': '•' };
  const SYMNAME = { '•': 'task', '×': 'done', '>': 'migrated', '○': 'event', '–': 'note' };
  function linesView(text, ci, key = '') {
    const rows = String(text || '').split('\n').map(parse).filter(Boolean);
    if (!rows.length) return '<div class="bj-empty">nothing yet · press EDIT</div>';
    return rows.map((p, i) => `<div class="bj-line s-${SYMNAME[p.s]}"><button class="bj-sym" data-act="sym" data-i="${i}" data-key="${esc(key)}" title="${SYMNAME[p.s]}${CYCLE[p.s] ? ' · click to change' : ''}">${p.s}</button><span>${esc(p.t)}</span></div>`).join('');
  }

  // ---------- storage ----------
  const seed = () => ({
    v: 1, cards: [
      { id: uid(), type: 'daily', title: niceDate(), text: '. write the first thing for today\nx open the bullet journal\n> move this to tomorrow if it does not happen\no something happening at a set time\n- a quick note to yourself' },
      { id: uid(), type: 'quote', q: 'The Matrix is everywhere. It is all around us.', by: 'Morpheus', hue: 0 },
      { id: uid(), type: 'habits', title: 'HABITS', habits: [{ name: 'water', days: {} }, { name: 'move', days: {} }, { name: 'write', days: {} }] },
      { id: uid(), type: 'mood', title: 'MOOD', moods: {} },
      { id: uid(), type: 'gratitude', title: 'GRATITUDE', date: today(), g: ['', '', ''] },
      { id: uid(), type: 'future', title: 'FUTURE LOG', months: futureMonths() },
      { id: uid(), type: 'collection', title: 'BOOKS TO READ', text: '. Neuromancer\n. The Doors of Perception\n- add more' },
    ],
  });
  function futureMonths() {
    const d = new Date(); d.setDate(1);
    return Array.from({ length: 6 }, (_, i) => { const m = new Date(d.getFullYear(), d.getMonth() + i, 1); return { label: m.toLocaleDateString([], { month: 'long', year: 'numeric' }).toUpperCase(), text: '' }; });
  }
  let D;
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && Array.isArray(v.cards)) return v; } catch {} return seed(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch {} };

  // ---------- cards ----------
  const TYPES = [['daily', 'DAILY LOG'], ['collection', 'COLLECTION'], ['habits', 'HABIT TRACKER'], ['future', 'FUTURE LOG'], ['mood', 'MOOD'], ['gratitude', 'GRATITUDE'], ['quote', 'STICKY QUOTE']];
  const blank = (type) => ({
    daily: { title: niceDate(), text: '' }, collection: { title: 'NEW COLLECTION', text: '' },
    habits: { title: 'HABITS', habits: [{ name: 'new habit', days: {} }] }, future: { title: 'FUTURE LOG', months: futureMonths() },
    mood: { title: 'MOOD', moods: {} }, gratitude: { title: 'GRATITUDE', date: today(), g: ['', '', ''] }, quote: { q: 'Write something worth keeping.', by: '', hue: 0 },
  }[type]);
  const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return d; });
  const MOODS = ['', '😞', '😕', '😐', '🙂', '😄'];
  const editing = new Set();
  const head = (c, label) => `<div class="bj-head"><span class="bj-grip" title="Drag to move this card">⠿</span>${c.title != null ? `<input class="bj-title" data-id="${c.id}" value="${esc(c.title)}" maxlength="40" spellcheck="false">` : `<b>${label}</b>`}<span class="bj-type">${label}</span>${['daily', 'collection', 'future', 'quote'].includes(c.type) ? `<button data-act="edit" title="${editing.has(c.id) ? 'Save' : 'Edit'}">${editing.has(c.id) ? 'DONE' : 'EDIT'}</button>` : ''}<button data-act="del" title="Delete this card">✕</button></div>`;

  function body(c) {
    const ed = editing.has(c.id);
    switch (c.type) {
      case 'daily': case 'collection':
        return ed ? `<textarea class="bj-ta" data-f="text" rows="8" spellcheck="true" placeholder=". task   x done   > migrated   o event   - note">${esc(c.text)}</textarea><div class="bj-hint">. task · x done · &gt; migrated · o event · - note</div>` : linesView(c.text, c.id);
      case 'future':
        return c.months.map((m, i) => `<div class="bj-month"><div class="bj-mh">${esc(m.label)}</div>${ed ? `<textarea class="bj-ta" data-f="m${i}" rows="3" spellcheck="true">${esc(m.text)}</textarea>` : linesView(m.text, c.id, 'm' + i)}</div>`).join('');
      case 'habits': {
        const days = lastDays(7);
        return `<div class="bj-grid bj-hgrid"><span></span>${days.map((d) => `<i>${d.toLocaleDateString([], { weekday: 'narrow' })}</i>`).join('')}<span></span></div>`
          + c.habits.map((h, hi) => `<div class="bj-grid bj-hgrid"><span class="bj-hn" title="${esc(h.name)}">${esc(h.name)}</span>${days.map((d) => `<button class="bj-day ${h.days[ymd(d)] ? 'on' : ''}" data-act="hday" data-h="${hi}" data-d="${ymd(d)}" title="${ymd(d)}">${h.days[ymd(d)] ? '×' : '·'}</button>`).join('')}<button class="bj-x" data-act="hdel" data-h="${hi}" title="Remove this habit">✕</button></div>`).join('')
          + `<div class="bj-add"><input class="bj-in" data-f="newhabit" placeholder="new habit, press Enter" maxlength="30"></div>`;
      }
      case 'mood':
        return `<div class="bj-moods">${lastDays(14).map((d) => `<button class="bj-mood" data-act="mood" data-d="${ymd(d)}" title="${ymd(d)}"><small>${d.getDate()}</small><span>${MOODS[c.moods[ymd(d)] || 0] || '·'}</span></button>`).join('')}</div><div class="bj-hint">click a day to change its mood</div>`;
      case 'gratitude':
        return `<div class="bj-hint">${esc(c.date === today() ? 'TODAY' : c.date)} · three good things</div>` + c.g.map((g, i) => `<input class="bj-in" data-f="g${i}" value="${esc(g)}" placeholder="${i + 1}." maxlength="120" spellcheck="true">`).join('')
          + (c.date !== today() ? '<button class="bj-btn" data-act="gnew">NEW DAY</button>' : '');
      case 'quote':
        return ed ? `<textarea class="bj-ta" data-f="q" rows="4" spellcheck="true">${esc(c.q)}</textarea><input class="bj-in" data-f="by" value="${esc(c.by)}" placeholder="who said it" maxlength="60"><button class="bj-btn" data-act="hue">COLOUR</button>`
          : `<blockquote>${esc(c.q)}</blockquote>${c.by ? `<cite>— ${esc(c.by)}</cite>` : ''}`;
    }
    return '';
  }
  const cardHtml = (c) => `<article class="bj-card t-${c.type} ${c.type === 'quote' ? 'hue' + (c.hue || 0) : ''}" data-id="${c.id}">${c.type === 'quote' ? `<div class="bj-head q"><span class="bj-grip" title="Drag to move this card">⠿</span><span class="bj-type">STICKY QUOTE</span><button data-act="edit">${editing.has(c.id) ? 'DONE' : 'EDIT'}</button><button data-act="del">✕</button></div>` : head(c, TYPES.find((t) => t[0] === c.type)?.[1] || c.type)}<div class="bj-body">${body(c)}</div></article>`;

  // ---------- the board ----------
  function mount(el) {
    D = load();
    el.classList.add('bujo');
    el.innerHTML = `<canvas class="bj-rain"></canvas>
      <div class="bj-bar"><b>BULLET JOURNAL</b><span class="bj-add-l">ADD A CARD</span>${TYPES.map(([k, l]) => `<button data-new="${k}">+ ${l}</button>`).join('')}<span class="grow"></span><span class="bj-legend">• task · × done · &gt; migrated · ○ event · – note</span></div>
      <div class="bj-scroll"><div class="bj-board" id="bj-board"></div></div>`;
    const board = el.querySelector('#bj-board');
    const draw = () => { board.innerHTML = D.cards.map(cardHtml).join('') || '<div class="bj-empty big">An empty board. Add a card above.</div>'; };
    const find = (t) => { const a = t.closest('.bj-card'); return a ? D.cards.find((c) => c.id === a.dataset.id) : null; };
    // pull what is typed in an open card back into the data
    const harvest = (art, c) => {
      art.querySelectorAll('[data-f]').forEach((f) => {
        const k = f.dataset.f;
        if (k === 'text') c.text = normalize(f.value); else if (k === 'q') c.q = f.value; else if (k === 'by') c.by = f.value;
        else if (/^m\d$/.test(k)) c.months[+k[1]].text = normalize(f.value);
        else if (/^g\d$/.test(k)) c.g[+k[1]] = f.value;
      });
    };
    el.querySelector('.bj-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-new]'); if (!b) return;
      D.cards.unshift({ id: uid(), type: b.dataset.new, ...structuredClone(blank(b.dataset.new)) });
      if (['daily', 'collection', 'quote', 'future'].includes(b.dataset.new)) editing.add(D.cards[0].id);
      save(); draw(); el.querySelector('.bj-scroll').scrollTop = 0;
    });
    board.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const c = find(b), art = b.closest('.bj-card'), act = b.dataset.act;
      if (!c) return;
      if (act === 'del') { if (!confirm('Delete this card?')) return; D.cards = D.cards.filter((x) => x !== c); }
      else if (act === 'edit') { if (editing.has(c.id)) { harvest(art, c); editing.delete(c.id); } else editing.add(c.id); }
      else if (act === 'sym') {
        const key = b.dataset.key, i = +b.dataset.i, get = () => (key ? c.months[+key[1]].text : c.text);
        const rows = get().split('\n').map(parse).filter(Boolean); const r = rows[i]; if (!r || !CYCLE[r.s]) return;
        rows[i] = { s: CYCLE[r.s], t: r.t }; const t = rows.map((p) => `${p.s} ${p.t}`).join('\n');
        if (key) c.months[+key[1]].text = t; else c.text = t;
      } else if (act === 'hday') { const h = c.habits[+b.dataset.h], d = b.dataset.d; if (h.days[d]) delete h.days[d]; else h.days[d] = 1; }
      else if (act === 'hdel') c.habits.splice(+b.dataset.h, 1);
      else if (act === 'mood') { const d = b.dataset.d; c.moods[d] = ((c.moods[d] || 0) + 1) % MOODS.length; if (!c.moods[d]) delete c.moods[d]; }
      else if (act === 'gnew') { c.date = today(); c.g = ['', '', '']; }
      else if (act === 'hue') { harvest(art, c); c.hue = ((c.hue || 0) + 1) % 4; }
      save(); draw();
    });
    board.addEventListener('change', (e) => {
      const t = e.target, c = find(t); if (!c) return;
      if (t.classList.contains('bj-title')) c.title = t.value.trim() || c.title;
      else if (/^g\d$/.test(t.dataset.f || '')) c.g[+t.dataset.f[1]] = t.value;
      save();
    });
    board.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.dataset.f === 'newhabit' && e.key === 'Enter' && t.value.trim()) { const c = find(t); c.habits.push({ name: t.value.trim(), days: {} }); save(); draw(); }
      if (t.classList.contains('bj-title') && e.key === 'Enter') t.blur();
    });
    // drag a card by its grip to a new place
    let drag = null;
    board.addEventListener('mousedown', (e) => { const art = e.target.closest('.bj-card'); if (art) art.draggable = !!e.target.closest('.bj-grip'); });
    board.addEventListener('dragstart', (e) => { const art = e.target.closest('.bj-card'); if (!art || !art.draggable) return e.preventDefault(); drag = art.dataset.id; e.dataTransfer.setData('text/hs-bujo', drag); e.dataTransfer.effectAllowed = 'move'; art.classList.add('dragging'); });
    board.addEventListener('dragend', () => { drag = null; board.querySelectorAll('.dragging, .over').forEach((x) => { x.classList.remove('dragging', 'over'); x.draggable = false; }); });
    board.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); board.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); e.target.closest('.bj-card')?.classList.add('over'); });
    board.addEventListener('drop', (e) => {
      if (!drag) return; e.preventDefault();
      const to = e.target.closest('.bj-card'), from = D.cards.findIndex((c) => c.id === drag);
      if (from < 0) return;
      const [c] = D.cards.splice(from, 1);
      const at = to ? D.cards.findIndex((x) => x.id === to.dataset.id) : D.cards.length;
      D.cards.splice(at < 0 ? D.cards.length : at, 0, c);
      drag = null; save(); draw();
    });
    draw();
    rain(el.querySelector('.bj-rain'), el);
  }

  // faint falling glyphs behind the board; stops when the tab is hidden or the app is in lite mode
  function rain(cv, host) {
    if (cv._on) return; cv._on = true;
    const g = cv.getContext('2d'), CH = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789•×○–<>=+'.split('');
    let cols = [], w = 0, h = 0, last = 0;
    const fit = () => { w = cv.width = host.clientWidth || 800; h = cv.height = host.clientHeight || 600; cols = Array.from({ length: Math.ceil(w / 18) }, () => Math.random() * -h / 16); };
    fit(); window.addEventListener('resize', fit);
    const tick = (t) => {
      requestAnimationFrame(tick);
      if (!host.offsetParent || document.hidden || t - last < 80) return;
      last = t;
      if (document.body.classList.contains('lite')) { if (cv._lite) return; cv._lite = true; g.clearRect(0, 0, w, h); return; }
      cv._lite = false;
      g.fillStyle = 'rgba(0, 8, 2, 0.14)'; g.fillRect(0, 0, w, h);
      g.font = '14px monospace';
      cols.forEach((y, i) => {
        g.fillStyle = Math.random() < 0.06 ? 'rgba(200,255,220,0.5)' : 'rgba(0,255,110,0.32)';
        g.fillText(CH[(Math.random() * CH.length) | 0], i * 18, y * 16);
        cols[i] = y * 16 > h && Math.random() > 0.97 ? 0 : y + 1;
      });
    };
    requestAnimationFrame(tick);
  }

  window.hsBujo = { mount };
})();
