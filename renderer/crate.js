// CRATE: a music player for your downloaded tracks with everything rekordbox knows about them (BPM, key in
// Camelot or musical, rating, colour, plays, hot/memory cues, playlists, history, the colour waveform) plus
// what SoundCloud knows (artwork, release date, genre, tags, label, stats, links). Plays through the
// two-deck engine in crate-engine.js, so tracks can hand over with a crossfade (bass swap, tempo match,
// beat-aligned start). Side panel: INFO, MIX NEXT (harmonic), DOUBLES (what layers well on top) and UP NEXT.
// The DJ DECKS sub-tab (crate-dj.js) uses the same decks by hand.
(() => {
  if (!document.getElementById('view-crate')) return;
  const E = window.CrateEngine;
  const rowH = 38;
  const XF_DEFAULTS = { T: 8, beatStart: true, bassSwap: true, matchTempo: true, skipTail: true };
  const C = {
    lib: null, byId: new Map(), list: [], view: { kind: 'all' }, sort: null, query: '',
    keyFmt: 'camelot', clean: true, queue: [], qi: -1, shuffle: false, repeat: 'off', cur: null, state: {},
    deck: E.A, sel: null, side: 'info', mode: 'player', feats: {}, mix: null, xf: { ...XF_DEFAULTS }, vol: 1,
  };
  try {
    const p = JSON.parse(localStorage.getItem('crate') || '{}');
    Object.assign(C, { keyFmt: p.keyFmt || 'camelot', clean: p.clean !== false, repeat: p.repeat || 'off', shuffle: !!p.shuffle, out: p.out || '', vol: p.vol ?? 1, xf: { ...XF_DEFAULTS, ...(p.xf || {}) } });
  } catch {}
  const savePrefs = () => { try { localStorage.setItem('crate', JSON.stringify({ keyFmt: C.keyFmt, clean: C.clean, repeat: C.repeat, shuffle: C.shuffle, vol: C.vol, out: C.out || '', xf: C.xf })); } catch {} };
  const au = () => C.deck.el;

  // ---------------- keys: musical ↔ Camelot ----------------
  const CAM = {
    'Abm': '1A', 'G#m': '1A', 'Ebm': '2A', 'D#m': '2A', 'Bbm': '3A', 'A#m': '3A', 'Fm': '4A', 'Cm': '5A', 'Gm': '6A', 'Dm': '7A', 'Am': '8A',
    'Em': '9A', 'Bm': '10A', 'F#m': '11A', 'Gbm': '11A', 'Dbm': '12A', 'C#m': '12A',
    'B': '1B', 'F#': '2B', 'Gb': '2B', 'Db': '3B', 'C#': '3B', 'Ab': '4B', 'G#': '4B', 'Eb': '5B', 'D#': '5B', 'Bb': '6B', 'A#': '6B',
    'F': '7B', 'C': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B',
  };
  const camelot = (k) => (k ? CAM[k.trim()] || (/^\d{1,2}[AB]$/i.test(k) ? k.toUpperCase() : null) : null);
  const keyHue = (cam) => (cam ? ((parseInt(cam, 10) - 1) * 30 + 120) % 360 : 140);
  const keyLabel = (t) => { const c = camelot(t.key); return C.keyFmt === 'camelot' ? c || t.key || '' : t.key || ''; };
  // steps round the Camelot wheel between two keys (0 = same), and whether the letter differs
  function keyDist(a, b) {
    if (!a || !b) return null;
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    const d = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
    return { d, rel: a.slice(-1) !== b.slice(-1) };
  }
  const compatible = (a, b) => { const k = keyDist(a, b); return !!k && ((k.d === 0) || (k.d === 1 && !k.rel)); };

  // ---------------- display helpers ----------------
  const JUNK = /\s*(?:klickaud|\(?\s*free\s*(?:dl|download)\s*\)?|\[\s*free\s*(?:dl|download)\s*\]|\(?\s*preview\s*\)?)\s*$/i;
  function cleanName(s) {
    if (!s) return s;
    let t = s.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
    for (let i = 0; i < 3; i++) t = t.replace(JUNK, '').trim();
    return t || s;
  }
  function names(t) {
    let title = t.title || '', artist = t.artist || '';
    if (!C.clean) return { title, artist };
    title = cleanName(title);
    if (!artist) { const m = title.match(/^(.+?)\s+-\s+(.+)$/); if (m) { artist = m[1]; title = m[2]; } }
    if (!artist && t.sc?.user) artist = t.sc.user;
    return { title, artist: cleanName(artist) };
  }
  const fmtLen = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtLong = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
  const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const released = (t) => t.sc?.released || null;
  const hashHue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
  const COLORS = { 1: '#ff4fa3', 2: '#ff3b3b', 3: '#ff9a1f', 4: '#ffe11f', 5: '#2ef06a', 6: '#22e4e4', 7: '#3c7dff', 8: '#a64dff' };
  const CUE_COLORS = ['#2ef06a', '#ff4fa3', '#ff3b3b', '#ff9a1f', '#ffe11f', '#22e4e4', '#3c7dff', '#a64dff'];
  // hs.media: hsmedia:// on the laptop, the phone-link server's /media/… on a phone
  const media = (kind, id) => (hs.media ? hs.media(kind, id) : `hsmedia://${kind}/${encodeURIComponent(id)}`);
  const artUrl = (t) => media('art', t.id);
  const art = (t, cls = 'cr-art') => (t.art ? `<i class="${cls}" style="background-image:url('${artUrl(t)}')"></i>`
    : `<i class="${cls} gen" style="--h:${keyHue(camelot(t.key)) || hashHue(t.id)}"></i>`);
  const plays = (t) => (t.plays || 0) + (C.state.plays?.[t.id] || 0);
  const trackUrl = (t) => media('track', t.id);

  // ---------------- loading ----------------
  async function load(refresh = false) {
    $('#cr-src').textContent = 'reading rekordbox…';
    try {
      const [lib, st] = await Promise.all([hs.call('libLoad', refresh), hs.call('crateState')]);
      C.lib = lib; C.state = st;
      C.byId = new Map(lib.tracks.map((t) => [t.id, t]));
      $('#cr-src').textContent = lib.source === 'rekordbox' ? `REKORDBOX · ${lib.tracks.length}` : lib.error ? lib.error : `${lib.tracks.length} tracks`;
      renderNav();
      setView(C.view, true);
      HS.data.crate = { ...(HS.data.crate || {}), count: lib.tracks.length };
      renderSettings();
      hs.call('libFeatures').then((f) => { C.feats = f || {}; renderSide(); }).catch(() => {});
    } catch (e) { $('#cr-src').textContent = `couldn't read the library: ${e.message}`; }
  }

  // ---------------- sidebar ----------------
  const doublesPlaylists = () => (C.lib?.playlists || []).filter((p) => /doubl/i.test(p.name));
  // rekordbox folders start closed (the HYPERSPACE one alone holds ~100 lists); which ones you opened is remembered
  let openFolders = new Set();
  try { openFolders = new Set(JSON.parse(localStorage.getItem('crate-folders') || '[]')); } catch {}
  const saveFolders = () => { try { localStorage.setItem('crate-folders', JSON.stringify([...openFolders])); } catch {} };
  function renderNav() {
    const L = C.lib;
    const missing = L.tracks.filter((t) => !t.exists).length;
    const item = (kind, label, n, extra = '') => `<button class="cr-item" data-kind="${kind}" ${extra}><span>${label}</span>${n != null ? `<em>${n}</em>` : ''}</button>`;
    const tg = C.tagger || L.tagger;
    const tagLog = (tg?.log || []).filter((e) => !e.undone).slice(0, 4);
    let h = `<div class="cr-tagger${tg?.enabled ? ' on' : ''}">
        <div class="cr-tg-h"><b>⚡ AUTO-TAGGER</b><button class="chip mini" id="cr-tg-toggle" title="Songs you download get BPM + key, a clean name, and go into your Music folder">${tg?.enabled ? 'ON' : 'OFF'}</button></div>
        <div class="dim tiny">${tg?.enabled ? `${tg.now ? `tagging ${esc(tg.now)}…` : 'watching Downloads'} → ${esc((tg.dest || '').split(/[\\/]/).pop())}` : 'off: downloads stay where they land'}</div>
        ${tagLog.map((e) => `<div class="cr-tg-row" title="${esc(e.newName)}"><span>${esc(e.newName.replace(/\.[^.]+$/, ''))}</span><button class="cr-tg-undo" data-undo="${esc(e.id)}" title="Put it back in Downloads with its old name">↶</button></div>`).join('')}
      </div>`;
    h += '<div class="cr-sec">LIBRARY</div>' + item('new', '★ NEW MUSIC', newList().length) +
      item('all', '◎ ALL TRACKS', L.tracks.length) + item('added', '✦ RECENTLY ADDED') + item('newest', '☄ NEWEST RELEASES') + item('top', '▲ MOST PLAYED') +
      item('recent', '◷ PLAYED IN HYPERSPACE', (C.state.recent || []).length) + item('liked', '♥ LIKED', (C.state.loved || []).length) +
      (missing ? item('missing', '⚠ MISSING FILES', missing) : '');
    const kids = new Map(), byId = new Map();
    for (const p of L.playlists || []) { const k = p.parent || 'root'; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(p); byId.set(p.id, p); }
    // the folders holding the playlist you're on stay open so it's never hidden
    const shown = new Set();
    for (let p = C.view.kind === 'pl' ? byId.get(C.view.id) : null; p && p.parent; p = byId.get(p.parent)) shown.add(p.parent);
    const tree = (parent, depth) => (kids.get(parent) || []).map((p) => {
      if (p.kind !== 1) return item('pl', `${p.kind === 4 ? '⚙' : '≡'} ${esc(p.name)}`, p.tracks.length, `data-id="${esc(p.id)}" style="--d:${depth}"`);
      const open = openFolders.has(p.id) || shown.has(p.id);
      return `<button class="cr-folder${open ? ' open' : ''}" data-fid="${esc(p.id)}" style="--d:${depth}"><span>${open ? '▾' : '▸'} ${esc(p.name)}</span><em>${(kids.get(p.id) || []).length}</em></button>${open ? tree(p.id, depth + 1) : ''}`;
    }).join('');
    h += smartNavHtml(item);
    if (L.playlists?.length) h += `<div class="cr-sec">PLAYLISTS</div>${tree('root', 0)}`;
    if (L.history?.length) h += '<div class="cr-sec">REKORDBOX HISTORY</div>' + L.history.slice(0, 12).map((x) => item('hist', `◴ ${esc(x.name || x.date)}`, x.tracks.length, `data-id="${esc(x.id)}"`)).join('');
    h += `<div class="cr-sec">FOLDERS <button class="chip mini" id="cr-addfolder" title="Add a folder of music that isn't in rekordbox">+ ADD</button></div>` +
      (L.folders || []).map((f) => `<div class="cr-fold">${item('folder', `▸ ${esc(f.split(/[\\/]/).pop())}`, null, `data-id="${esc(f)}" title="${esc(f)}"`)}<button class="cr-unfold" data-dir="${esc(f)}" title="Remove this folder">✕</button></div>`).join('') +
      (!(L.folders || []).length ? '<div class="dim tiny cr-pad">rekordbox tracks show up automatically</div>' : '');
    $('#cr-nav').innerHTML = h;
    markNav();
  }
  function markNav() {
    $$('#cr-nav .cr-item').forEach((b) => b.classList.toggle('on', b.dataset.kind === C.view.kind && (b.dataset.id || null) === (C.view.id || null)));
  }
  $('#cr-nav').addEventListener('click', async (e) => {
    if (e.target.id === 'cr-addfolder') { C.lib.folders = await hs.call('libAddFolder'); return load(); }
    if (e.target.id === 'cr-tg-toggle') { C.tagger = await hs.call('taggerSet', { enabled: !(C.tagger || C.lib.tagger)?.enabled }); return renderNav(); }
    const ud = e.target.closest('[data-undo]');
    if (ud) { try { const r = await hs.call('taggerUndo', ud.dataset.undo); toast(`BACK IN DOWNLOADS · ${r.oldName}`); } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), true); } C.tagger = await hs.call('taggerGet'); return renderNav(); }
    const un = e.target.closest('.cr-unfold');
    if (un) { await hs.call('libRemoveFolder', un.dataset.dir); return load(); }
    const fo = e.target.closest('.cr-folder');
    if (fo) {
      const id = fo.dataset.fid, sc = $('#cr-nav').scrollTop;
      if (fo.classList.contains('open')) openFolders.delete(id); else openFolders.add(id);
      saveFolders(); renderNav(); $('#cr-nav').scrollTop = sc;
      return;
    }
    const b = e.target.closest('.cr-item');
    if (b) setView({ kind: b.dataset.kind, id: b.dataset.id || null });
  });

  // ---------------- SMART PLAYLISTS: rule-based lists that re-run every time you open them ----------------
  // saved in localStorage 'hs-crate-smart' as [{ id, name, root:{op,items}, sort:{k,dir}, limit }]; a rule is { f, o, v }
  const SF = {
    bpm: { l: 'BPM', ops: [['between', 'between', 'range'], ['gte', 'at least', 'num'], ['lte', 'at most', 'num'], ['near', 'within ±3 of', 'num']] },
    key: { l: 'KEY', ops: [['compat', 'compatible with (Camelot)', 'key'], ['same', 'same key as', 'key'], ['pm1', '±1 on the wheel of', 'key'], ['now', 'compatible with NOW PLAYING', 'none']] },
    energy: { l: 'ENERGY %', ops: [['gte', 'at least', 'num'], ['lte', 'at most', 'num'], ['between', 'between', 'range']] },
    genre: { l: 'GENRE / TAGS', ops: [['has', 'contains', 'text'], ['hasnot', 'does not contain', 'text']] },
    artist: { l: 'ARTIST', ops: [['has', 'contains', 'text'], ['hasnot', 'does not contain', 'text']] },
    title: { l: 'TITLE', ops: [['has', 'contains', 'text'], ['hasnot', 'does not contain', 'text']] },
    year: { l: 'RELEASE YEAR', ops: [['between', 'between', 'range'], ['gte', 'from', 'num'], ['lte', 'up to', 'num']] },
    added: { l: 'DATE ADDED', ops: [['within', 'in the last (days)', 'num'], ['older', 'more than (days) ago', 'num']] },
    rating: { l: 'RATING ★', ops: [['gte', 'at least', 'num'], ['lte', 'at most', 'num'], ['is', 'exactly', 'num']] },
    plays: { l: 'PLAYED', ops: [['never', 'never', 'none'], ['ever', 'at least once', 'none'], ['gte', 'at least (times)', 'num'], ['lte', 'at most (times)', 'num']] },
  };
  const SORTS = { added: 'DATE ADDED', bpm: 'BPM', key: 'KEY', rating: 'RATING', plays: 'PLAYED', title: 'TITLE', artist: 'ARTIST', energy: 'ENERGY', random: 'RANDOM' };
  const grp = (op, items) => ({ op, items });
  const rl = (f, o, v) => ({ f, o, v });
  const SMART_DEFAULTS = () => [
    { id: 'sm-warm', name: 'WARM-UP 100-118 BPM', root: grp('and', [rl('bpm', 'between', [100, 118])]), sort: { k: 'bpm', dir: 1 }, limit: 0 },
    { id: 'sm-peak', name: 'PEAK 124-132 BPM', root: grp('and', [rl('bpm', 'between', [124, 132])]), sort: { k: 'bpm', dir: 1 }, limit: 0 },
    { id: 'sm-key', name: 'KEY MATCH TO NOW PLAYING', root: grp('and', [rl('key', 'now', null)]), sort: { k: 'bpm', dir: 1 }, limit: 0 },
    { id: 'sm-new', name: 'RECENTLY ADDED', root: grp('and', [rl('added', 'within', 30)]), sort: { k: 'added', dir: -1 }, limit: 50 },
    { id: 'sm-never', name: 'NEVER PLAYED', root: grp('and', [rl('plays', 'never', null)]), sort: { k: 'added', dir: -1 }, limit: 0 },
  ];
  let smart = null;
  try { smart = JSON.parse(localStorage.getItem('hs-crate-smart')); } catch {}
  if (!Array.isArray(smart)) smart = SMART_DEFAULTS();
  const saveSmart = () => { try { localStorage.setItem('hs-crate-smart', JSON.stringify(smart)); } catch {} };
  saveSmart();
  const smartUsesNow = (n) => (n.items ? n.items.some(smartUsesNow) : n.f === 'key' && n.o === 'now');
  const yearOf = (t) => { const y = parseInt(String(t.sc?.released || '').slice(0, 4), 10); return y > 1900 ? y : null; };
  const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);
  function smartRule(r, t, ctx) {
    const v = r.v;
    const lo = num(Array.isArray(v) ? v[0] : v), hi = num(Array.isArray(v) ? v[1] : null);
    switch (r.f) {
      case 'bpm': { const b = t.bpm; if (!b) return false;
        if (r.o === 'between') return (lo == null || b >= lo) && (hi == null || b <= hi);
        if (lo == null) return true;
        return r.o === 'gte' ? b >= lo : r.o === 'lte' ? b <= lo : Math.abs(b - lo) <= 3; }
      case 'key': { const mine = camelot(t.key), want = r.o === 'now' ? ctx.cam : camelot(String(v || ''));
        if (!mine || !want) return false;
        const k = keyDist(mine, want);
        return r.o === 'same' ? k.d === 0 && !k.rel : r.o === 'pm1' ? k.d <= 1 && !k.rel : (k.d === 0) || (k.d === 1 && !k.rel); }
      case 'energy': { const e = C.feats[t.id]?.e; if (e == null) return false;
        return r.o === 'between' ? (lo == null || e >= lo) && (hi == null || e <= hi) : lo == null ? true : r.o === 'gte' ? e >= lo : e <= lo; }
      case 'genre': case 'artist': case 'title': {
        const q = String(v || '').toLowerCase().trim(); if (!q) return true; const n = names(t);
        const hay = (r.f === 'genre' ? `${t.genre || ''} ${t.sc?.genre || ''} ${(t.sc?.tags || []).join(' ')}` : r.f === 'artist' ? `${n.artist} ${t.artist || ''}` : `${n.title} ${t.title || ''}`).toLowerCase();
        return hay.includes(q) === (r.o === 'has'); }
      case 'year': { const y = yearOf(t); if (y == null) return false;
        return r.o === 'between' ? (lo == null || y >= lo) && (hi == null || y <= hi) : lo == null ? true : r.o === 'gte' ? y >= lo : y <= lo; }
      case 'added': { const d = Date.parse(t.added); if (isNaN(d) || lo == null) return false; const age = (Date.now() - d) / 864e5; return r.o === 'within' ? age <= lo : age > lo; }
      case 'rating': { const g = t.rating || 0; return lo == null ? true : r.o === 'gte' ? g >= lo : r.o === 'lte' ? g <= lo : g === lo; }
      case 'plays': { const p = plays(t); return r.o === 'never' ? p === 0 : r.o === 'ever' ? p > 0 : lo == null ? true : r.o === 'gte' ? p >= lo : p <= lo; }
    }
    return true;
  }
  function smartNode(n, t, ctx) {
    if (!n.items) return smartRule(n, t, ctx);
    if (!n.items.length) return true;
    return n.op === 'or' ? n.items.some((x) => smartNode(x, t, ctx)) : n.items.every((x) => smartNode(x, t, ctx));
  }
  function smartRun(sp) {
    const nowT = C.cur || (C.sel && C.byId.get(C.sel)) || null;
    const ctx = { cam: nowT ? camelot(nowT.key) : null };
    const useNow = smartUsesNow(sp.root);
    let list = (C.lib?.tracks || []).filter((t) => t.exists && !(useNow && nowT && t.id === nowT.id) && smartNode(sp.root, t, ctx));
    const k = sp.sort?.k || 'added', dir = sp.sort?.dir || 1;
    if (k === 'random') list = list.map((t) => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    else {
      const val = (t) => (k === 'title' ? names(t).title.toLowerCase() : k === 'artist' ? names(t).artist.toLowerCase() : k === 'key' ? (camelot(t.key) || 'zz').padStart(3, '0')
        : k === 'plays' ? plays(t) : k === 'energy' ? C.feats[t.id]?.e ?? -1 : k === 'added' ? String(t.added || '') : t[k] ?? 0);
      list = list.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir; });
    }
    return sp.limit > 0 ? list.slice(0, sp.limit) : list;
  }
  const smartBy = (id) => smart.find((s) => s.id === id);
  // sidebar section
  function smartNavHtml(item) {
    return `<div class="cr-sec">SMART PLAYLISTS <button class="chip mini" id="cr-sm-new" title="Build a playlist from rules; it re-fills itself">+ NEW</button></div>` +
      smart.map((s) => item('smart', `⚡ ${esc(s.name)}`, smartRun(s).length, `data-id="${esc(s.id)}"`)).join('');
  }
  function smartMenu(e, s) {
    window.hsMenu?.(e, [
      { label: '▶ Play', run: () => { const l = smartRun(s); if (l.length) playFrom(l, 0); else toast('NOTHING MATCHES YET', true); } },
      { label: 'Edit rules…', run: () => smartEdit(s.id) },
      { label: 'Rename…', run: () => smartEdit(s.id, true) },
      { label: 'Duplicate', run: () => { const c = JSON.parse(JSON.stringify(s)); c.id = `sm-${Date.now().toString(36)}`; c.name = `${s.name} COPY`; smart.splice(smart.indexOf(s) + 1, 0, c); saveSmart(); renderNav(); } },
      '-',
      { label: 'Delete', danger: true, run: () => {
        if (!confirm(`Delete the smart playlist "${s.name}"? (Your tracks are not touched.)`)) return;
        smart = smart.filter((x) => x !== s); saveSmart(); if (C.view.kind === 'smart' && C.view.id === s.id) C.view = { kind: 'all' }; renderNav(); setView(C.view); } },
    ], s.name);
  }
  $('#cr-nav').addEventListener('contextmenu', (e) => { const b = e.target.closest('.cr-item[data-kind="smart"]'); if (b) { const s = smartBy(b.dataset.id); if (s) smartMenu(e, s); } });
  $('#cr-nav').addEventListener('click', (e) => { if (e.target.id === 'cr-sm-new') smartEdit(null); });
  // the current track changed: lists that follow it re-run
  function smartOnTrack() {
    if (!smart.some((s) => smartUsesNow(s.root))) return;
    if (C.lib) { const sc = $('#cr-nav').scrollTop; renderNav(); $('#cr-nav').scrollTop = sc; }
    if (C.view.kind === 'smart' && smartUsesNow(smartBy(C.view.id)?.root || { items: [] })) setView(C.view, true);
  }
  // editor
  let sd = null; // { id, draft }
  const smartAt = (path) => path.reduce((n, i) => n.items[i], sd.draft.root);
  const pth = (s) => (s === '' || s == null ? [] : String(s).split(',').map(Number));
  function smartEdit(id, focusName = false) {
    const src = id ? smartBy(id) : null;
    const draft = src ? JSON.parse(JSON.stringify(src)) : { id: `sm-${Date.now().toString(36)}`, name: 'NEW SMART PLAYLIST', root: grp('and', [rl('bpm', 'between', [120, 130])]), sort: { k: 'added', dir: -1 }, limit: 0 };
    sd = { id: src ? src.id : null, draft };
    let m = $('#cr-smart');
    if (!m) { m = document.createElement('div'); m.id = 'cr-smart'; m.className = 'cr-smart-modal'; $('#view-crate').appendChild(m); wireSmart(m); }
    m.classList.remove('hidden');
    paintSmart();
    const nm = $('#sm-name'); if (nm && focusName) { nm.focus(); nm.select(); }
  }
  const optsHtml = (pairs, cur) => pairs.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const KEYS = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();
  function ruleHtml(r, p) {
    const F = SF[r.f] || SF.bpm, op = F.ops.find((o) => o[0] === r.o) || F.ops[0], kind = op[2];
    const a = Array.isArray(r.v) ? r.v : [r.v, null];
    let val = '';
    if (kind === 'range') val = `<input class="sm-v" data-role="v0" type="number" value="${a[0] ?? ''}" placeholder="from"><span class="dim">to</span><input class="sm-v" data-role="v1" type="number" value="${a[1] ?? ''}" placeholder="to">`;
    else if (kind === 'num') val = `<input class="sm-v" data-role="v0" type="number" value="${Array.isArray(r.v) ? '' : r.v ?? ''}">`;
    else if (kind === 'text') val = `<input class="sm-v wide" data-role="v0" type="text" value="${esc(r.v ?? '')}" placeholder="text">`;
    else if (kind === 'key') val = `<select class="sm-v" data-role="v0">${optsHtml(KEYS.map((k) => [k, k]), r.v || '8A')}</select>`;
    return `<div class="sm-r" data-p="${p}"><select data-role="f">${optsHtml(Object.entries(SF).map(([k, f]) => [k, f.l]), r.f)}</select>
      <select data-role="o">${optsHtml(F.ops.map((o) => [o[0], o[1]]), op[0])}</select>${val}<button class="sm-x" data-act="del" title="Remove this rule">✕</button></div>`;
  }
  function groupHtml(g, p, depth) {
    return `<div class="sm-g d${depth}" data-p="${p}"><div class="sm-gh">MATCH <select data-role="gop"><option value="and"${g.op === 'and' ? ' selected' : ''}>ALL (AND)</option><option value="or"${g.op === 'or' ? ' selected' : ''}>ANY (OR)</option></select> OF
      <button class="chip mini" data-act="addr">+ RULE</button>${depth < 2 ? '<button class="chip mini" data-act="addg">+ GROUP</button>' : ''}${depth ? '<button class="sm-x" data-act="del" title="Remove this group">✕</button>' : ''}</div>
      ${g.items.map((n, i) => { const q = p === '' ? String(i) : `${p},${i}`; return n.items ? groupHtml(n, q, depth + 1) : ruleHtml(n, q); }).join('') || '<div class="dim tiny cr-pad">no rules: matches every track</div>'}</div>`;
  }
  function paintSmart() {
    const d = sd.draft, m = $('#cr-smart');
    m.innerHTML = `<div class="cr-smart"><div class="cr-sm-head"><b>⚡ SMART PLAYLIST</b><input id="sm-name" type="text" maxlength="60" value="${esc(d.name)}"><span class="sm-count" id="sm-count"></span></div>
      <div class="sm-body">${groupHtml(d.root, '', 0)}</div>
      <div class="sm-foot"><label>SORT <select id="sm-sort">${optsHtml(Object.entries(SORTS), d.sort.k)}</select></label>
        <button class="chip mini" id="sm-dir" title="Flip the order">${d.sort.dir < 0 ? '▼ HIGH → LOW' : '▲ LOW → HIGH'}</button>
        <label>LIMIT <input id="sm-limit" type="number" min="0" value="${d.limit || ''}" placeholder="all" title="Keep only the first N, e.g. 50 for a top 50"></label>
        <span class="sm-sp"></span><button class="chip" id="sm-cancel">CANCEL</button><button class="chip on" id="sm-save">SAVE</button></div>
      <div class="dim tiny sm-note">NOW PLAYING rules use the selected track until something plays · ENERGY rules need the drop scan to have finished</div></div>`;
    smartCount();
  }
  function smartCount() {
    const n = smartRun(sd.draft).length, el = $('#sm-count');
    if (el) el.textContent = `${n} TRACK${n === 1 ? '' : 'S'} MATCH`;
  }
  function wireSmart(m) {
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.add('hidden'); });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !sd) return;
      if (b.id === 'sm-cancel') return m.classList.add('hidden');
      if (b.id === 'sm-dir') { sd.draft.sort.dir *= -1; return paintSmart(); }
      if (b.id === 'sm-save') {
        const d = sd.draft; d.name = (d.name || '').trim() || 'SMART PLAYLIST';
        const i = smart.findIndex((s) => s.id === sd.id);
        if (i >= 0) smart[i] = d; else smart.push(d);
        saveSmart(); m.classList.add('hidden'); renderNav(); setView({ kind: 'smart', id: d.id }); return;
      }
      const act = b.dataset.act; if (!act) return;
      const p = pth(b.closest('[data-p]').dataset.p);
      if (act === 'addr') smartAt(p).items.push(rl('bpm', 'between', [120, 130]));
      else if (act === 'addg') smartAt(p).items.push(grp('and', [rl('genre', 'has', '')]));
      else if (act === 'del') smartAt(p.slice(0, -1)).items.splice(p[p.length - 1], 1);
      paintSmart();
    });
    m.addEventListener('input', (e) => {
      if (!sd) return; const t = e.target, role = t.dataset.role;
      if (t.id === 'sm-name') sd.draft.name = t.value;
      else if (t.id === 'sm-limit') sd.draft.limit = Math.max(0, parseInt(t.value, 10) || 0);
      else if (role === 'v0' || role === 'v1') {
        const r = smartAt(pth(t.closest('[data-p]').dataset.p)), kind = SF[r.f].ops.find((o) => o[0] === r.o)[2];
        if (kind === 'range') { const a = Array.isArray(r.v) ? r.v : [null, null]; a[role === 'v0' ? 0 : 1] = t.value === '' ? null : +t.value; r.v = a; }
        else r.v = kind === 'num' ? (t.value === '' ? null : +t.value) : t.value;
      } else return;
      smartCount();
    });
    m.addEventListener('change', (e) => {
      if (!sd) return; const t = e.target, role = t.dataset.role;
      if (t.id === 'sm-sort') { sd.draft.sort.k = t.value; return smartCount(); }
      if (role === 'gop') { smartAt(pth(t.closest('[data-p]').dataset.p)).op = t.value; return smartCount(); }
      if (role === 'v0' && t.tagName === 'SELECT') { smartAt(pth(t.closest('[data-p]').dataset.p)).v = t.value; return smartCount(); }
      if (role !== 'f' && role !== 'o') return;
      const r = smartAt(pth(t.closest('[data-p]').dataset.p));
      if (role === 'f') { r.f = t.value; r.o = SF[r.f].ops[0][0]; } else r.o = t.value;
      const kind = SF[r.f].ops.find((o) => o[0] === r.o)[2];
      r.v = kind === 'range' ? [null, null] : kind === 'key' ? '8A' : kind === 'text' ? '' : kind === 'none' ? null : r.f === 'added' ? 30 : r.f === 'rating' ? 3 : r.f === 'plays' ? 1 : r.f === 'energy' ? 60 : r.f === 'year' ? 2020 : 120;
      paintSmart();
    });
  }

  // ---------------- views ----------------
  // NEW MUSIC: everything that reached your library in the last 30 days, newest first (▶ plays it like a radio)
  function newList() {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return (C.lib?.tracks || []).filter((t) => t.exists && String(t.added || '') >= cutoff).sort((a, b) => String(b.added).localeCompare(String(a.added)));
  }
  function baseList(v) {
    const T = C.lib.tracks, by = (ids) => ids.map((id) => C.byId.get(id)).filter(Boolean);
    switch (v.kind) {
      case 'new': return { title: 'NEW MUSIC', kicker: 'ADDED IN THE LAST 30 DAYS · PRESS ▶ TO PLAY THEM ALL', list: newList(), ordered: true };
      case 'pl': { const p = C.lib.playlists.find((x) => x.id === v.id); return { title: p?.name || 'PLAYLIST', kicker: 'REKORDBOX PLAYLIST', list: by(p?.tracks || []), ordered: true }; }
      case 'smart': { const s = smartBy(v.id); return s ? { title: s.name, kicker: smartUsesNow(s.root) ? "SMART PLAYLIST · FOLLOWS WHAT'S PLAYING" : 'SMART PLAYLIST · FILLS ITSELF FROM YOUR RULES · RIGHT-CLICK IT TO EDIT', list: smartRun(s), ordered: true } : { title: 'ALL TRACKS', kicker: 'LIBRARY', list: [...T] }; }
      case 'hist': { const p = C.lib.history.find((x) => x.id === v.id); return { title: p?.name || 'HISTORY', kicker: 'REKORDBOX HISTORY', list: by(p?.tracks || []), ordered: true }; }
      case 'added': return { title: 'RECENTLY ADDED', kicker: 'LIBRARY', list: [...T].sort((a, b) => String(b.added).localeCompare(String(a.added))).slice(0, 250) };
      case 'newest': return { title: 'NEWEST RELEASES', kicker: 'BY SOUNDCLOUD RELEASE DATE', list: T.filter(released).sort((a, b) => String(released(b)).localeCompare(String(released(a)))).slice(0, 250) };
      case 'top': return { title: 'MOST PLAYED', kicker: 'LIBRARY', list: T.filter((t) => plays(t) > 0).sort((a, b) => plays(b) - plays(a)).slice(0, 250) };
      case 'recent': return { title: 'PLAYED IN HYPERSPACE', kicker: 'LIBRARY', list: by(C.state.recent || []) };
      case 'liked': return { title: 'LIKED', kicker: 'LIBRARY', list: by(C.state.loved || []) };
      case 'missing': return { title: 'MISSING FILES', kicker: 'MOVED OR DELETED SINCE REKORDBOX SAW THEM', list: T.filter((t) => !t.exists) };
      case 'folder': return { title: v.id.split(/[\\/]/).pop(), kicker: v.id, list: T.filter((t) => t.folder && t.path.toLowerCase().startsWith(v.id.toLowerCase())) };
      default: return { title: 'ALL TRACKS', kicker: 'LIBRARY', list: [...T].sort((a, b) => String(b.added).localeCompare(String(a.added))) };
    }
  }
  function matches(t, q) {
    for (const tok of q) {
      let m;
      if ((m = tok.match(/^bpm:(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/))) {
        const lo = +m[1], hi = m[2] ? +m[2] : null;
        if (hi != null ? !(t.bpm >= lo && t.bpm <= hi) : Math.abs(t.bpm - lo) > 1.5) return false;
      } else if ((m = tok.match(/^key:(.+)$/))) {
        const want = camelot(m[1].replace(/^./, (c) => c.toUpperCase())) || m[1].toUpperCase();
        if ((camelot(t.key) || '').toUpperCase() !== want.toUpperCase()) return false;
      } else if ((m = tok.match(/^genre:(.+)$/))) {
        if (!`${t.genre || ''} ${t.sc?.genre || ''}`.toLowerCase().includes(m[1])) return false;
      } else if ((m = tok.match(/^(?:★|rating:)(\d)$/))) {
        if ((t.rating || 0) < +m[1]) return false;
      } else {
        const n = names(t);
        const hay = `${n.title} ${n.artist} ${t.title} ${t.album || ''} ${t.genre || ''} ${t.label || ''} ${t.comment || ''} ${t.remixer || ''} ${t.sc?.genre || ''} ${(t.sc?.tags || []).join(' ')} ${t.sc?.label || ''}`.toLowerCase();
        if (!hay.includes(tok)) return false;
      }
    }
    return true;
  }
  function setView(v, keepScroll = false) {
    C.view = v;
    const b = baseList(v);
    let list = b.list;
    const q = C.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (q.length) list = list.filter((t) => matches(t, q));
    if (C.sort) {
      const { key, dir } = C.sort;
      const val = (t) => (key === 'title' ? names(t).title.toLowerCase() : key === 'key' ? (camelot(t.key) || 'zz').padStart(3, '0')
        : key === 'plays' ? plays(t) : key === 'released' ? released(t) || '' : key === 'genre' ? (t.genre || t.sc?.genre || '').toLowerCase() : t[key] ?? '');
      list = [...list].sort((x, y) => { const a = val(x), c = val(y); return (a < c ? -1 : a > c ? 1 : 0) * dir; });
    }
    C.list = list;
    $('#cr-title').textContent = b.title.toUpperCase();
    $('#cr-kicker').textContent = b.kicker;
    const total = list.reduce((s, t) => s + (t.len || 0), 0);
    $('#cr-meta').textContent = `${list.length} tracks · ${fmtLong(total)}${q.length ? ' · filtered' : ''}`;
    $('#cr-cover').style.setProperty('--h', (hashHue(b.title) % 80) + 110);
    $$('#cr-thead [data-sort]').forEach((h) => { h.classList.toggle('asc', C.sort?.key === h.dataset.sort && C.sort.dir > 0); h.classList.toggle('desc', C.sort?.key === h.dataset.sort && C.sort.dir < 0); });
    if (!keepScroll) $('#cr-body').scrollTop = 0;
    markNav();
    renderRows(true);
  }

  // ---------------- virtual track table ----------------
  let lastRange = '';
  function renderRows(force = false) {
    const body = $('#cr-body');
    const first = Math.max(0, Math.floor(body.scrollTop / rowH) - 8);
    const last = Math.min(C.list.length, Math.ceil((body.scrollTop + body.clientHeight) / rowH) + 8);
    const key = `${first}:${last}:${C.list.length}:${C.cur?.id}:${C.sel}:${C.keyFmt}:${C.clean}:${C.mode}`;
    if (!force && key === lastRange) return;
    lastRange = key;
    const rows = $('#cr-rows');
    rows.style.height = `${C.list.length * rowH}px`;
    let h = '';
    for (let i = first; i < last; i++) {
      const t = C.list[i], n = names(t), cam = camelot(t.key);
      const playing = C.cur?.id === t.id;
      const rel = released(t);
      h += `<div class="cr-row cr-tr${playing ? ' playing' : ''}${C.sel === t.id ? ' sel' : ''}${t.exists ? '' : ' gone'}" data-i="${i}" draggable="${C.mode === 'dj'}" style="top:${i * rowH}px;--tc:${COLORS[t.color] || 'transparent'}">
        <div class="c-n">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : i + 1}</div>
        <div class="c-t">${art(t)}<div><b>${esc(n.title)}</b><span>${t.sc ? '<em class="scb" title="found on SoundCloud">☁</em>' : ''}${esc(n.artist || t.album || '')}</span></div>${C.mode === 'dj' ? '<span class="ld"><button data-ld="A" title="Load on deck A">A</button><button data-ld="B" title="Load on deck B">B</button></span>' : ''}</div>
        <div class="c-b">${t.bpm ? t.bpm.toFixed(t.bpm % 1 ? 1 : 0) : '—'}</div>
        <div class="c-k">${t.key || cam ? `<span class="kb" style="--kh:${keyHue(cam)}">${esc(keyLabel(t))}</span>` : '—'}</div>
        <div class="c-l">${t.len ? fmtLen(t.len) : '—'}</div>
        <div class="c-g">${esc(t.genre || t.sc?.genre || '')}</div>
        <div class="c-r">${t.rating ? '★'.repeat(Math.min(5, t.rating)) : ''}</div>
        <div class="c-p">${plays(t) || ''}</div>
        <div class="c-a">${rel ? esc(String(rel).slice(0, 10)) : ''}</div>
      </div>`;
    }
    rows.innerHTML = h || `<div class="cr-empty">${C.lib ? (C.query ? 'nothing matches that search' : 'no tracks here yet') : 'loading…'}</div>`;
  }
  $('#cr-body').addEventListener('scroll', () => renderRows());
  new ResizeObserver(() => renderRows(true)).observe($('#cr-body'));
  $('#cr-rows').addEventListener('click', (e) => {
    const r = e.target.closest('.cr-tr');
    if (!r) return;
    const t = C.list[+r.dataset.i];
    const ld = e.target.closest('[data-ld]');
    if (ld) return window.CrateDJ?.load(ld.dataset.ld, t);
    C.sel = t.id;
    // re-highlight in place: rebuilding the rows here would swap the element out from under a double-click
    $$('#cr-rows .cr-tr.sel').forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    renderSide();
  });
  $('#cr-rows').addEventListener('dblclick', (e) => {
    const r = e.target.closest('.cr-tr');
    if (!r || e.target.closest('[data-ld]')) return;
    if (C.mode === 'dj') return window.CrateDJ?.loadFree(C.list[+r.dataset.i]);
    playFrom(C.list, +r.dataset.i);
  });
  $('#cr-rows').addEventListener('contextmenu', (e) => {
    const r = e.target.closest('.cr-tr');
    if (!r) return;
    e.preventDefault();
    const t = C.list[+r.dataset.i];
    C.queue.splice(C.qi + 1, 0, t.id);
    renderQueue();
    toast(`UP NEXT · ${names(t).title.toUpperCase()}`);
  });
  $('#cr-rows').addEventListener('dragstart', (e) => {
    const r = e.target.closest('.cr-tr');
    if (r) e.dataTransfer.setData('text/hs-track', C.list[+r.dataset.i].id);
  });
  $$('#cr-thead [data-sort]').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.sort;
    if (C.sort?.key === k) C.sort = C.sort.dir > 0 ? { key: k, dir: -1 } : null;
    else C.sort = { key: k, dir: ['bpm', 'rating', 'plays', 'len', 'added', 'released'].includes(k) ? -1 : 1 };
    setView(C.view);
  }));
  let qTimer;
  $('#cr-search').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { C.query = e.target.value.trim(); setView(C.view); }, 120); });
  $('#cr-keyfmt').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; C.keyFmt = b.dataset.v; savePrefs(); syncTools(); renderRows(true); renderPlayer(); renderSide(); });
  $('#cr-clean').addEventListener('click', () => { C.clean = !C.clean; savePrefs(); syncTools(); renderRows(true); renderPlayer(); renderSide(); });
  $('#cr-refresh').addEventListener('click', () => load(true));
  $('#cr-settings').addEventListener('click', () => HS.actions.openSettings?.('crate'));
  // the big play button follows the real state: pause while playing, resume (same spot) while paused, start the list only when nothing is loaded
  $('#cr-playall').addEventListener('click', () => {
    if (C.cur && !(au().paused && !C.list.some((x) => x.id === C.cur.id) && !C.queue.includes(C.cur.id))) { toggle(); return; }
    if (C.list.length) playFrom(C.list, 0);
  });
  $('#cr-shuffleall').addEventListener('click', () => { if (!C.list.length) return; C.shuffle = true; savePrefs(); playFrom(C.list, (Math.random() * C.list.length) | 0); });
  function syncTools() {
    $$('#cr-keyfmt button').forEach((b) => b.classList.toggle('on', b.dataset.v === C.keyFmt));
    $('#cr-clean').classList.toggle('on', C.clean);
    $('#cr-shuf').classList.toggle('on', C.shuffle);
    $('#cr-rep').classList.toggle('on', C.repeat !== 'off');
    $('#cr-rep').textContent = C.repeat === 'one' ? '↻¹' : '↻';
    $('#cr-xfade').textContent = C.xf.T > 0 ? `XFADE ${C.xf.T}s` : 'NO XFADE';
    $$('#cr-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === C.mode));
  }

  // ---------------- PLAYER / DJ sub-tabs ----------------
  function setMode(m) {
    C.mode = m;
    $('.crate').classList.toggle('dj-mode', m === 'dj');
    $('#cr-dj').classList.toggle('hidden', m !== 'dj');
    syncTools();
    renderRows(true);
    if (m === 'dj') { cancelMix(true); window.CrateDJ?.show(); }
    try { localStorage.setItem('crateMode', m); } catch {}
    window.dispatchEvent(new Event('hs-crate-mode'));
  }
  $('#cr-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

  // ---------------- playback (the player uses deck A and B in turn) ----------------
  function playFrom(list, i) {
    const playable = list.filter((t) => t.exists);
    const start = list[i];
    let ids = playable.map((t) => t.id);
    if (C.shuffle) { ids = ids.filter((id) => id !== start.id).sort(() => Math.random() - 0.5); ids.unshift(start.id); }
    C.queue = ids;
    C.qi = Math.max(0, ids.indexOf(start.id));
    playId(C.queue[C.qi]);
  }
  async function playId(id, { deck = null, at = 0 } = {}) {
    const t = C.byId.get(id);
    if (!t) return;
    if (!t.exists) { toast(`MISSING FILE · ${names(t).title}`, true); return next(); }
    cancelMix(true);
    const d = deck || C.deck;
    const other = E.other(d);
    if (!deck) { other.el.pause(); E.resetDeck(other); }
    C.deck = d;
    C.cur = t;
    E.resetDeck(d);
    E.setFader(d, 1);
    E.setXf(d === E.A ? 0 : 1);
    await E.load(d, t, trackUrl(t));
    if (at) d.el.currentTime = at;
    E.resume();
    try { await d.el.play(); } catch (e) { toast(`CAN'T PLAY THIS FILE (${e.name})`, true); }
    afterStart(t);
  }
  function afterStart(t) {
    renderPlayer(); renderRows(true); renderQueue(); renderMix(); renderSide(); smartOnTrack();
    loadWave(C.deck, t);
    hs.call('libPlayed', t.id).then(() => { C.state.plays = { ...(C.state.plays || {}), [t.id]: ((C.state.plays || {})[t.id] || 0) + 1 }; C.state.recent = [t.id, ...(C.state.recent || []).filter((x) => x !== t.id)]; }).catch(() => {});
    mediaSession(t);
  }
  function next(auto = false) {
    if (!C.queue.length) return;
    if (auto && C.repeat === 'one') { au().currentTime = 0; au().play(); return; }
    if (C.qi + 1 >= C.queue.length) { if (C.repeat === 'all') C.qi = -1; else { au().pause(); renderPlayer(); return; } }
    C.qi++;
    playId(C.queue[C.qi]);
  }
  function prev() {
    if (au().currentTime > 3 || C.qi <= 0) { au().currentTime = 0; return; }
    C.qi--;
    playId(C.queue[C.qi]);
  }
  function toggle() {
    if (!C.cur) { if (C.list.length) playFrom(C.list, 0); return; }
    E.resume();
    if (au().paused) { au().play(); if (C.mix?.phase === 'running') E.other(C.deck).el.play(); } else { au().pause(); if (C.mix?.phase === 'running') E.other(C.deck).el.pause(); }
  }
  for (const d of E.decks) {
    d.el.addEventListener('ended', () => { if (C.mode === 'player' && d === C.deck && !C.mix) next(true); });
    d.el.addEventListener('play', () => { if (d === C.deck) renderPlayer(); });
    d.el.addEventListener('pause', () => { if (d === C.deck) renderPlayer(); });
    d.el.addEventListener('ended', () => { if (d === C.deck) renderPlayer(); });
    d.el.addEventListener('loadedmetadata', () => { if (d === C.deck && C.cur && !C.cur.len) C.cur.len = Math.round(d.el.duration); if (d === C.deck) renderPlayer(); });
    d.el.addEventListener('error', () => { if (d === C.deck && C.cur && d.el.src) toast(`CAN'T PLAY ${names(C.cur).title.toUpperCase()} · FORMAT NOT SUPPORTED`, true); });
  }
  $('#cr-play').addEventListener('click', toggle);
  $('#cr-next').addEventListener('click', () => next());
  $('#cr-prev').addEventListener('click', prev);
  $('#cr-shuf').addEventListener('click', () => {
    C.shuffle = !C.shuffle; savePrefs(); syncTools();
    if (C.cur && C.queue.length) {
      const rest = C.queue.slice(C.qi + 1);
      if (C.shuffle) rest.sort(() => Math.random() - 0.5);
      C.queue = [...C.queue.slice(0, C.qi + 1), ...rest];
      renderQueue();
    }
  });
  $('#cr-rep').addEventListener('click', () => { C.repeat = { off: 'all', all: 'one', one: 'off' }[C.repeat]; savePrefs(); syncTools(); });
  $('#cr-vol').value = Math.round(C.vol * 100);
  E.setMaster(C.vol);
  $('#cr-vol').addEventListener('input', (e) => { C.vol = e.target.value / 100; E.setMaster(C.vol); savePrefs(); });
  $('#cr-love').addEventListener('click', () => {
    if (!C.cur) return;
    const loved = new Set(C.state.loved || []);
    loved.has(C.cur.id) ? loved.delete(C.cur.id) : loved.add(C.cur.id);
    C.state.loved = [...loved];
    HS.saveConfig({ crate: { loved: C.state.loved } });
    renderPlayer(); renderNav();
  });
  // the SIDE DOCK's CRATE module: what's playing (sent when it changes), and its buttons
  let dockLast = '';
  setInterval(() => {
    if (HS.solo) return;
    const t = C.cur, n = t ? names(t) : null;
    const s = t ? { id: t.id, title: n.title, artist: n.artist, bpm: t.bpm, key: keyLabel(t), playing: !au().paused, pos: Math.round(au().currentTime || 0), len: Math.round(au().duration || t.len || 0), art: !!t.art } : null;
    const k = JSON.stringify(s);
    if (k !== dockLast) { dockLast = k; hs.call('dockData', 'crate', s).catch(() => {}); }
  }, 1000);
  // the dock's and the phone's buttons
  hs.on('dock-cmd', (c) => {
    if (HS.solo || c.key !== 'crate') return;
    if (c.action === 'toggle') toggle(); else if (c.action === 'next') next(); else if (c.action === 'prev') prev();
    else if (c.action === 'seek' && C.cur && isFinite(c.arg)) au().currentTime = Math.max(0, +c.arg);
    else if (c.action === 'play' && c.arg?.id) {
      const list = (c.arg.ids || [c.arg.id]).map((id) => C.byId.get(id)).filter(Boolean);
      const i = list.findIndex((t) => t.id === c.arg.id);
      if (i >= 0) { E.resume(); playFrom(list, i); }
    }
  });
  HS.actions.crateToggle = toggle;
  HS.actions.crateNext = () => next();

  // ---------------- transitions: beatmatched blends, counted in bars ----------------
  // The next track starts on the other deck at its first downbeat, time-stretched (key lock) to this track's tempo
  // (half/double-time folded, at most +-8%), and it is released exactly on OUR next downbeat. Both beat grids come from
  // rekordbox, or from listening (E.detectGrid) for files it never analysed. While the two play together a small
  // phase-lock loop nudges the incoming deck's speed so the kicks stay on top of each other. The crossfader moves over
  // 1-32 BARS (not seconds), the bass swaps over one bar in the middle, the outgoing deck is filtered thin at the
  // end, then the borrowed tempo eases back to the track's own.
  const BAR_STEPS = [1, 2, 4, 8, 16, 32];
  const MAX_STRETCH = 0.08;
  const LEAD = 14; // seconds of warning to load, listen to and line up the next track
  const dbCache = new WeakMap();
  const downbeatsOf = (d) => { const g = E.gridOf(d); if (!g) return []; let r = dbCache.get(g); if (!r) dbCache.set(g, r = g.filter((b) => b[1] === 1).map((b) => b[0] / 1000)); return r; };
  const nearestBars = (x) => BAR_STEPS.reduce((a, c) => (Math.abs(Math.log(c / Math.max(0.5, x))) < Math.abs(Math.log(a / Math.max(0.5, x))) ? c : a), 1);
  function musicEnd(t, d) {
    const f = C.feats[t.id];
    const dur = d.el.duration || t.len || 0;
    return C.xf.skipTail && f?.endMs > 0 ? Math.min(dur, f.endMs / 1000 + 1) : dur;
  }
  // where the blend starts on the outgoing track: { at (track s), T (real s), bars, span (track s) }
  function mixPoint(t, d) {
    const end = musicEnd(t, d), rate = d.el.playbackRate || 1, bpm = E.bpmNative(d);
    const dbs = C.xf.beatStart ? downbeatsOf(d) : [];
    if (!dbs.length || !bpm) { const T = Math.min(C.xf.T, Math.max(0, end - 1)); return { at: end - T, T, bars: 0, span: T }; }
    const barS = 240 / bpm; // one bar, in track seconds
    for (let bars = nearestBars(C.xf.T / (barS / rate)); bars >= 1; bars = bars > 1 ? bars / 2 : 0) {
      let at = -1;
      for (let i = dbs.length - 1; i >= 0; i--) if (dbs[i] + bars * barS <= end + 0.3) { at = dbs[i]; break; }
      if (at >= 0) return { at, T: bars * barS / rate, bars, span: bars * barS };
    }
    const T = Math.min(C.xf.T, Math.max(0, end - 1));
    return { at: end - T, T, bars: 0, span: T };
  }
  // seconds into the bar (real time) for a deck, with the real length of one of its beats
  const barSec = (d) => { const p = E.phase(d); return p ? { s: ((p.inBar - 1) + p.frac) * p.len / (d.el.playbackRate || 1), beat: p.len / (d.el.playbackRate || 1) } : null; };
  const wrapTo = (v, P) => { v %= P; if (v > P / 2) v -= P; else if (v < -P / 2) v += P; return v; };
  let glideId = 0;
  async function startMix() {
    const outD = C.deck, inD = E.other(outD);
    const nt = C.byId.get(C.queue[C.qi + 1]);
    if (!nt?.exists) return;
    const outT = C.cur;
    const mix = C.mix = { outD, inD, track: nt, phase: 'loading', status: 'PREPARING MIX…', T: Math.max(1, mixPoint(outT, outD).T), bars: 0, synced: false, err: 0, fix: 0, fold: 1, base: 1 };
    glideId++; // a tempo glide left over from the last blend must not fight this one
    E.resetDeck(inD);
    E.setFader(inD, 1);
    await E.load(inD, nt, trackUrl(nt));
    if (C.mix !== mix) return;
    inD.wave = await fetchWave(nt).catch(() => null);
    if (C.mix !== mix) return;
    let synced = false;
    if (C.xf.beatStart) {
      const [gi0, go0] = await Promise.all([E.ensureGrid(inD, 'start', trackUrl(nt)), E.ensureGrid(outD, 'end', trackUrl(outT))]);
      synced = !!(gi0?.length && go0?.length);
    }
    if (C.mix !== mix) return;
    // tempo: the incoming deck takes ours (folded to within +-8%)
    let fold = 1, base = 1;
    const bOut = E.bpmNow(outD), bIn = E.bpmNative(inD);
    if (synced && bOut && bIn) {
      let r = bOut / bIn;
      while (r > 1.41) { r /= 2; fold *= 2; }
      while (r < 0.71) { r *= 2; fold /= 2; }
      if (Math.abs(r - 1) <= MAX_STRETCH && C.xf.matchTempo) base = r;
      else synced = false; // too far apart to stretch: a time blend instead
    } else synced = false;
    const nowOut = outD.el.currentTime, end = musicEnd(outT, outD);
    let at = nowOut + 0.1, bars = 0, T = Math.max(1, Math.min(C.xf.T, end - nowOut - 0.5));
    if (synced) {
      const mp = mixPoint(outT, outD), dbs = downbeatsOf(outD), barS = 240 / E.bpmNative(outD);
      let start = mp.at;
      if (start < nowOut + 0.35) start = dbs.find((x) => x >= nowOut + 0.35) ?? -1; // loading took long: the next bar line
      bars = mp.bars || 1;
      while (bars > 1 && start + bars * barS > end + 0.3) bars /= 2;
      if (start < 0 || start + barS > end + 0.5) synced = false;
      else { at = start; T = bars * barS / (outD.el.playbackRate || 1); }
    }
    if (!synced) { // no beat grid, or tempos too far apart: blend by time, still matching the tempo when it is close
      bars = 0; fold = 1; base = 1;
      if (C.xf.matchTempo && bOut && bIn) { let r = bOut / bIn; if (r > 1.5) r /= 2; else if (r < 0.67) r *= 2; if (Math.abs(r - 1) <= 0.1) base = r; }
    }
    E.setPitch(inD, (base - 1) * 100);
    const gi = E.gridOf(inD);
    const inStart = ((gi || []).find((b) => b[1] === 1)?.[0] ?? 0) / 1000;
    inD.el.currentTime = inStart;
    if (C.xf.bassSwap && T >= 3) E.setKill(inD, 'low', true);
    Object.assign(mix, { phase: 'armed', synced, fold, at, T, bars, base, status: synced ? `SYNCED ${bOut.toFixed(0)} BPM` : 'TIME BLEND' });
    E.resume();
    // now it waits: stepMix releases the new track on the downbeat
  }
  function releaseMix(m) {
    m.phase = 'running';
    m.t0 = performance.now();
    m.started = true;
    m.inD.el.play().catch(() => {});
    toast(m.synced ? `MIXING → ${names(m.track).title.toUpperCase()} · SYNCED ${E.bpmNow(m.outD).toFixed(0)} BPM · ${m.bars} BAR${m.bars === 1 ? '' : 'S'}` : `MIXING → ${names(m.track).title.toUpperCase()} · ${Math.round(m.T)} s BLEND`);
  }
  function stepMix() {
    const m = C.mix;
    if (!m) return;
    if (m.phase === 'armed') {
      if (m.outD.el.paused && !m.outD.el.ended) return;
      const wait = m.synced ? m.at - m.outD.el.currentTime : 0;
      if (wait <= 0.045) releaseMix(m); // ~45 ms: the audio element's start-up delay
      return;
    }
    if (m.phase !== 'running') return;
    const { outD, inD } = m, fromA = outD === E.A;
    let p;
    if (m.synced) {
      const outRate = outD.el.playbackRate || 1;
      // phase-lock: keep the incoming deck's bar position on top of the outgoing one's
      const a = barSec(outD), b = barSec(inD);
      m.base = outRate * (E.bpmNative(outD) / E.bpmNative(inD)) / m.fold;
      if (a && b && !inD.el.paused) {
        const P = m.fold === 1 ? a.beat * 4 : Math.max(a.beat, b.beat);
        const err = wrapTo(b.s - a.s, P);
        m.err = err;
        if (Math.abs(err) > 0.09 && m.fix < 4 && performance.now() - m.t0 > 120) { // late out of the gate: jump the difference
          inD.el.currentTime = Math.max(0, inD.el.currentTime - err * (inD.el.playbackRate || 1)); m.fix++;
        } else {
          const nudge = Math.abs(err) < 0.004 ? 0 : Math.max(-0.035, Math.min(0.035, -err * 0.6));
          const want = m.base * (1 + nudge);
          if (Math.abs(inD.el.playbackRate - want) > 0.0002) inD.el.playbackRate = want;
        }
      }
      p = (outD.el.currentTime - m.at) / (m.bars * 240 / E.bpmNative(outD));
    } else p = (performance.now() - m.t0) / 1000 / Math.max(0.1, m.T);
    p = Math.max(0, Math.min(1, p));
    const e = p * p * (3 - 2 * p); // eased; the mixer's gains are still equal-power
    E.setXf(fromA ? e : 1 - e);
    if (C.xf.bassSwap && m.T >= 3) { // the kicks trade places over one bar around the middle
      const half = m.bars ? 0.5 / m.bars : 0.1, q = Math.max(0, Math.min(1, (p - (0.5 - half)) / (2 * half)));
      if (q <= 0) E.setKill(inD, 'low', true);
      else if (q >= 1) { if (!m.swapped) { m.swapped = true; E.setKill(inD, 'low', false); E.setEq(inD, 'low', 0); E.setKill(outD, 'low', true); } }
      else { E.setKill(inD, 'low', false); E.setKill(outD, 'low', false); E.setEq(inD, 'low', -26 * Math.pow(1 - q, 1.5)); E.setEq(outD, 'low', -26 * Math.pow(q, 1.5)); }
    }
    if (m.synced && p > 0.75) E.setFilter(outD, Math.min(0.55, (p - 0.75) * 2.2)); // the outgoing track thins out last
    if (p >= 1 || outD.el.ended) finishMix();
  }
  function finishMix() {
    const m = C.mix;
    C.mix = null;
    m.outD.el.pause();
    E.resetDeck(m.outD);
    C.deck = m.inD;
    C.cur = m.track;
    C.qi++;
    // ease the borrowed tempo back to the track's own (smoothstep over ~16 s)
    const d = m.inD, from = d.pitch, id = ++glideId;
    d.el.playbackRate = 1 + from / 100;
    if (Math.abs(from) > 0.05) { const t0 = performance.now(); const glide = () => { if (C.deck !== d || id !== glideId) return; const k = Math.min(1, (performance.now() - t0) / 16000); E.setPitch(d, from * (1 - k * k * (3 - 2 * k))); if (k < 1) setTimeout(glide, 150); }; setTimeout(glide, 1500); }
    afterStart(C.cur);
  }
  function cancelMix(keepCurrent) {
    const m = C.mix;
    if (!m) return;
    C.mix = null;
    m.inD.el.pause();
    E.resetDeck(m.inD);
    E.setKill(m.outD, 'low', false); E.setEq(m.outD, 'low', 0); E.setFilter(m.outD, 0);
    if (keepCurrent) E.setXf(m.outD === E.A ? 0 : 1);
  }
  let preloadFor = null;
  function checkMix() {
    if (C.mode !== 'player' || !C.cur || C.mix || au().paused || C.xf.T <= 0 || C.repeat === 'one') return;
    if (C.qi + 1 >= C.queue.length) return;
    const { at, bars } = mixPoint(C.cur, C.deck);
    if (!isFinite(at) || at <= 1) return;
    const go = at - (bars ? LEAD * (au().playbackRate || 1) : 0);
    if (au().currentTime >= go && preloadFor !== C.cur.id + at) { preloadFor = C.cur.id + at; startMix(); }
  }

  // output device: preview on headphones while the room hears something else
  async function loadOutputs() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      $('#cr-out').innerHTML = '<option value="">default output</option>' + devs.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'output')}</option>`).join('');
      if (C.out && devs.some((d) => d.deviceId === C.out)) { $('#cr-out').value = C.out; E.setSink(C.out).catch(() => {}); }
    } catch {}
  }
  $('#cr-out').addEventListener('change', async (e) => {
    try { await E.setSink(e.target.value); C.out = e.target.value; savePrefs(); toast('PLAYING THROUGH ' + e.target.selectedOptions[0].textContent.toUpperCase()); }
    catch (er) { toast(`COULDN'T SWITCH OUTPUT: ${er.message}`, true); }
  });

  function mediaSession(t) {
    if (!('mediaSession' in navigator)) return;
    const n = names(t);
    navigator.mediaSession.metadata = new MediaMetadata({ title: n.title, artist: n.artist || '', album: t.album || 'HYPERSPACE CRATE', artwork: t.art ? [{ src: artUrl(t) }] : [] });
    navigator.mediaSession.setActionHandler('play', () => au().play());
    navigator.mediaSession.setActionHandler('pause', () => au().pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('seekto', (d) => { au().currentTime = d.seekTime; });
  }

  // ---------------- now playing ----------------
  function renderPlayer() {
    const t = C.cur;
    $('#cr-play').textContent = au().paused ? '▶' : '❚❚';
    $('#cr-play').classList.toggle('on', !au().paused);
    const bp = $('#cr-playall'), pl = !!C.cur && !au().paused;
    bp.textContent = pl ? '❚❚' : '▶'; bp.classList.toggle('on', pl);
    bp.title = pl ? 'Pause' : (C.cur && au().currentTime > 0 ? 'Resume' : 'Play this list');
    if (!t) return;
    const n = names(t), cam = camelot(t.key);
    $('#cr-npart').innerHTML = art(t, 'cr-npimg');
    $('#cr-nptitle').textContent = n.title;
    $('#cr-npartist').textContent = n.artist || t.album || '';
    $('#cr-badges').innerHTML = [t.bpm ? `<span class="bdg">${t.bpm.toFixed(t.bpm % 1 ? 1 : 0)} BPM</span>` : '', t.key ? `<span class="bdg kb" style="--kh:${keyHue(cam)}">${esc(keyLabel(t))}${C.keyFmt === 'camelot' && cam ? ` · ${esc(t.key)}` : ''}</span>` : '',
      (t.genre || t.sc?.genre) ? `<span class="bdg dim">${esc(t.genre || t.sc.genre)}</span>` : '', released(t) ? `<span class="bdg dim">${esc(String(released(t)).slice(0, 4))}</span>` : ''].join('');
    $('#cr-love').textContent = (C.state.loved || []).includes(t.id) ? '♥' : '♡';
    $('#cr-love').classList.toggle('on', (C.state.loved || []).includes(t.id));
    const hot = (t.cues || []).filter((c) => c[1] > 0).sort((a, b) => a[1] - b[1]);
    $('#cr-cues').innerHTML = hot.length ? hot.map((c) => `<button class="cue" data-ms="${c[0]}" style="--cc:${CUE_COLORS[(c[2] || c[1]) % 8]}" title="${esc(c[3] || '')} · ${fmtLen(c[0] / 1000)}">${String.fromCharCode(64 + c[1])}</button>`).join('') : '<span class="dim tiny">no hot cues</span>';
    $('#cr-tlen').textContent = fmtLen(au().duration || t.len);
    HS.data.crate = { ...(HS.data.crate || {}), playing: !au().paused, title: n.title, artist: n.artist, bpm: t.bpm, key: keyLabel(t) };
  }
  $('#cr-cues').addEventListener('click', (e) => { const b = e.target.closest('.cue'); if (b) { au().currentTime = +b.dataset.ms / 1000; if (au().paused) au().play(); } });

  // ---------------- waveforms ----------------
  function unpack(w) {
    if (!w?.ok) return null;
    const raw = atob(w.data), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    w.bytes = bytes;
    return w;
  }
  async function fetchWave(t, cols = 1600) {
    if (t.wave) { const w = unpack(await hs.call('libWave', t.id, cols)); if (w) return w; }
    return decodeWave(t);
  }
  async function loadWave(d, t) {
    const w = await fetchWave(t).catch(() => null);
    if (d.track?.id === t.id) { d.wave = w; drawWave(); }
    if (d === C.deck && C.xf.T > 0 && C.xf.beatStart && !w?.beats?.length && d.track?.id === t.id) E.ensureGrid(d, 'end', trackUrl(t)).then(() => { if (d.track?.id === t.id) drawWave(); }); // files rekordbox never analysed: listen for the beat grid now, so the mix is ready
  }
  // tracks rekordbox never analysed: decode the audio once and take peaks
  async function decodeWave(t) {
    if (t.size > 80e6) return null;
    const buf = await (await fetch(trackUrl(t))).arrayBuffer();
    const ac = new OfflineAudioContext(1, 2, 44100);
    const data = (await ac.decodeAudioData(buf)).getChannelData(0);
    const cols = 1600, out = new Uint8Array(cols * 4), step = Math.floor(data.length / cols);
    for (let c = 0; c < cols; c++) {
      let mx = 0;
      for (let i = c * step; i < (c + 1) * step; i += 16) { const v = Math.abs(data[i]); if (v > mx) mx = v; }
      out.set([60, 255, 140, Math.min(255, mx * 300)], c * 4);
    }
    return { ok: true, kind: 'decoded', cols, bytes: out, beats: [] };
  }
  const wc = $('#cr-wave');
  let hoverX = null;
  function drawWave() {
    const box = wc.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (wc.width !== Math.round(box.width * dpr) || wc.height !== Math.round(box.height * dpr)) { wc.width = Math.round(box.width * dpr); wc.height = Math.round(box.height * dpr); }
    const ctx = wc.getContext('2d'), W = wc.width, H = wc.height, mid = H * 0.62;
    ctx.clearRect(0, 0, W, H);
    const t = C.cur, el = au(), dur = el.duration || t?.len || 0;
    const pos = dur ? el.currentTime / dur : 0;
    const w = C.deck.wave;
    if (w?.bytes) {
      const bars = Math.floor(W / (3 * dpr));
      for (let b = 0; b < bars; b++) {
        const c = Math.floor((b / bars) * w.cols) * 4;
        const r = w.bytes[c], g = w.bytes[c + 1], bl = w.bytes[c + 2], h = w.bytes[c + 3] / 255;
        const played = b / bars < pos;
        const x = b * 3 * dpr, hh = Math.max(1, h * mid * 0.96);
        ctx.fillStyle = played ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},0.38)`;
        ctx.fillRect(x, mid - hh, 2 * dpr, hh);
        ctx.fillStyle = played ? `rgba(${r},${g},${bl},0.45)` : `rgba(${r},${g},${bl},0.15)`;
        ctx.fillRect(x, mid + 1 * dpr, 2 * dpr, hh * 0.42);
      }
      if (w.beats?.length && dur) { // phrase lines every 16 bars
        ctx.fillStyle = 'rgba(234,255,240,0.18)';
        let bar = 0;
        for (const [ms, beat] of w.beats) if (beat === 1 && bar++ % 16 === 0) ctx.fillRect((ms / 1000 / dur) * W, 0, 1, H);
      }
      const f = t && C.feats[t.id]; // the drop, marked
      if (f?.d1ms > 0 && dur) { ctx.fillStyle = 'rgba(255,196,0,0.85)'; const x = (f.d1ms / 1000 / dur) * W; ctx.fillRect(x, H - 4 * dpr, 2 * dpr, 4 * dpr); ctx.font = `${8 * dpr}px "Share Tech Mono", monospace`; ctx.fillText('DROP', x + 3 * dpr, H - 1 * dpr); }
      if (C.xf.T > 0 && t && C.mode === 'player' && C.qi + 1 < C.queue.length && dur) { // where the crossfade starts
        const { at } = mixPoint(t, C.deck);
        ctx.fillStyle = 'rgba(29,233,182,0.18)';
        ctx.fillRect((at / dur) * W, 0, W - (at / dur) * W, H);
      }
    } else {
      ctx.fillStyle = 'rgba(0,255,110,0.15)'; ctx.fillRect(0, mid - 1, W, 2);
      ctx.fillStyle = 'rgba(0,255,110,0.8)'; ctx.fillRect(0, mid - 1, W * pos, 2);
    }
    if (t?.cues && dur) for (const [ms, kind, col] of t.cues) {
      const x = (ms / 1000 / dur) * W;
      if (kind > 0) {
        ctx.fillStyle = CUE_COLORS[(col || kind) % 8];
        ctx.fillRect(x, 0, 1.5 * dpr, H);
        ctx.fillRect(x, 0, 11 * dpr, 11 * dpr);
        ctx.fillStyle = '#001a08'; ctx.font = `bold ${9 * dpr}px "Share Tech Mono", monospace`; ctx.textBaseline = 'top';
        ctx.fillText(String.fromCharCode(64 + kind), x + 2.5 * dpr, 1 * dpr);
      } else {
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x - 4 * dpr, H - 6 * dpr); ctx.lineTo(x + 4 * dpr, H - 6 * dpr); ctx.fill();
      }
    }
    ctx.fillStyle = '#eafff0';
    ctx.fillRect(W * pos - dpr, 0, 2 * dpr, H);
    if (hoverX != null && dur) {
      ctx.fillStyle = 'rgba(234,255,240,0.35)'; ctx.fillRect(hoverX * dpr, 0, dpr, H);
      ctx.font = `${10 * dpr}px "Share Tech Mono", monospace`; ctx.fillStyle = '#eafff0'; ctx.textBaseline = 'top';
      ctx.fillText(fmtLen((hoverX / box.width) * dur), hoverX * dpr + 4 * dpr, 2 * dpr);
    }
  }
  function seekAt(e) {
    const r = wc.getBoundingClientRect(), dur = au().duration || C.cur?.len;
    if (!dur) return;
    cancelMix(true);
    au().currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    preloadFor = null;
    drawWave();
  }
  let dragging = false;
  wc.addEventListener('pointerdown', (e) => { dragging = true; wc.setPointerCapture(e.pointerId); seekAt(e); });
  wc.addEventListener('pointermove', (e) => { hoverX = e.offsetX; if (dragging) seekAt(e); });
  wc.addEventListener('pointerup', () => { dragging = false; });
  wc.addEventListener('pointerleave', () => { hoverX = null; });

  function barPos() {
    const p = E.phase(C.deck);
    if (!p) return C.mix ? C.mix.status : '';
    let bar = 0;
    const beats = E.gridOf(C.deck);
    for (let i = 0; i <= p.i; i++) if (beats[i][1] === 1) bar++;
    const mx = C.mix && C.mix.phase !== 'loading' ? ` · MIXING → ${C.mix.status}${C.mix.synced && C.mix.phase === 'running' ? ` · ${C.mix.bars} BARS · Δ${Math.round(Math.abs(C.mix.err) * 1000)} ms` : ''}` : C.mix ? ` · ${C.mix.status}` : '';
    return `BAR ${bar} · ${p.inBar}/4 · ${E.bpmNow(C.deck).toFixed(1)} BPM${mx}`;
  }
  let barTick = 0;
  function tick() {
    requestAnimationFrame(tick);
    stepMix();
    if (++barTick % 10 === 0) checkMix();
    if (HS.view !== 'crate' || !C.cur || C.mode !== 'player') return;
    $('#cr-tcur').textContent = fmtLen(au().currentTime);
    drawWave();
    if (barTick % 6 === 0) $('#cr-pos').textContent = barPos();
  }
  requestAnimationFrame(tick);

  // crossfade settings, quick access from the player bar
  function xfadeHtml(prefix) {
    return `<label class="set-l">CROSSFADE LENGTH <b id="${prefix}-tv">${C.xf.T ? `${C.xf.T} s` : 'OFF'}</b></label>
      <input type="range" class="slider" id="${prefix}-t" min="0" max="30" step="1" value="${C.xf.T}" />
      <label class="check"><input type="checkbox" data-xf="beatStart"${C.xf.beatStart ? ' checked' : ''} /> beatmatch: bars, not seconds (grid + downbeats line up)</label>
      <label class="check"><input type="checkbox" data-xf="matchTempo"${C.xf.matchTempo ? ' checked' : ''} /> stretch tempo to match (up to ±8%)</label>
      <label class="check"><input type="checkbox" data-xf="bassSwap"${C.xf.bassSwap ? ' checked' : ''} /> bass swap in the middle (no clashing kicks)</label>
      <label class="check"><input type="checkbox" data-xf="skipTail"${C.xf.skipTail ? ' checked' : ''} /> skip the silent tail of each track</label>`;
  }
  function bindXfade(root, prefix) {
    root.querySelector(`#${prefix}-t`).addEventListener('input', (e) => { C.xf.T = +e.target.value; root.querySelector(`#${prefix}-tv`).textContent = C.xf.T ? `${C.xf.T} s` : 'OFF'; savePrefs(); syncTools(); });
    root.querySelectorAll('[data-xf]').forEach((x) => x.addEventListener('change', () => { C.xf[x.dataset.xf] = x.checked; savePrefs(); }));
  }
  $('#cr-xfade').addEventListener('click', () => {
    const p = $('#cr-xpop');
    if (!p.classList.contains('hidden')) return p.classList.add('hidden');
    p.innerHTML = `<div class="cr-sub">TRANSITIONS</div>${xfadeHtml('xp')}`;
    bindXfade(p, 'xp');
    p.classList.remove('hidden');
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#cr-xpop, #cr-xfade')) $('#cr-xpop').classList.add('hidden'); });

  // ---------------- side panel: INFO · MIX NEXT · DOUBLES · UP NEXT ----------------
  $('#cr-stabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-side]');
    if (!b) return;
    C.side = b.dataset.side;
    $$('#cr-stabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.cr-sidepage').forEach((p) => p.classList.toggle('hidden', p.dataset.sidep !== C.side));
    renderSide();
  });
  const focusTrack = () => C.byId.get(C.sel) || C.cur;
  function renderSide() {
    if (C.side === 'info') renderInfo();
    else if (C.side === 'doubles') renderDoubles();
    else if (C.side === 'mix') renderMix();
    else renderQueue();
  }
  function renderInfo() {
    const t = focusTrack(), box = $('#cr-info');
    if (!t) { box.innerHTML = '<div class="dim tiny cr-pad">click a track to see everything about it</div>'; return; }
    const n = names(t), s = t.sc, cam = camelot(t.key), f = C.feats[t.id];
    const row = (k, v) => (v || v === 0 ? `<div><span>${k}</span><b>${v}</b></div>` : '');
    const sizeMb = t.size ? `${(t.size / 1048576).toFixed(1)} MB` : '';
    box.innerHTML = `
      <div class="ci-art">${t.art ? `<img src="${artUrl(t)}" alt="" />` : art(t, 'ci-gen')}</div>
      <div class="ci-title">${esc(n.title)}</div><div class="ci-artist">${esc(n.artist || '')}</div>
      <div class="cr-badges">${t.bpm ? `<span class="bdg">${t.bpm.toFixed(t.bpm % 1 ? 1 : 0)} BPM</span>` : ''}${t.key ? `<span class="bdg kb" style="--kh:${keyHue(cam)}">${esc(cam || '')} · ${esc(t.key)}</span>` : ''}${t.len ? `<span class="bdg dim">${fmtLen(t.len)}</span>` : ''}${t.rating ? `<span class="bdg dim">${'★'.repeat(t.rating)}</span>` : ''}</div>
      <div class="ci-btns"><button class="act" data-ci="play">▶ PLAY</button><button class="act" data-ci="next">+ NEXT</button>${C.mode === 'dj' ? '<button class="act" data-ci="A">DECK A</button><button class="act" data-ci="B">DECK B</button>' : ''}</div>
      <div class="ci-sec">SOUNDCLOUD ${s ? `<em>${s.s === 'manual' ? 'linked by you' : `match ${Math.round((s.c || 0) * 100)}%`}</em>` : ''}</div>
      ${s ? `<div class="core-rows ci-rows">
          ${row('released', fmtDate(s.released))}${row('uploaded by', `${esc(s.user || '')}${s.verified ? ' ✓' : ''}`)}${row('genre', esc(s.genre || ''))}
          ${row('label', esc(s.label || ''))}${row('album', esc(s.album || ''))}${row('plays', fmtNum(s.plays))}${row('likes', fmtNum(s.likes))}${row('reposts', fmtNum(s.reposts))}${row('comments', fmtNum(s.comments))}${row('ISRC', esc(s.isrc || ''))}
        </div>
        ${s.tags?.length ? `<div class="ci-tags">${s.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${s.desc ? `<div class="ci-desc">${esc(s.desc)}</div>` : ''}
        <div class="ci-btns"><button class="act" data-ci="sc">OPEN ON SOUNDCLOUD</button>${s.buy ? `<button class="act" data-ci="buy" title="${esc(s.buy.url)}">${esc(s.buy.title.slice(0, 24).toUpperCase())}</button>` : ''}${s.userUrl ? '<button class="act" data-ci="artist">ARTIST</button>' : ''}</div>`
        : `<div class="dim tiny cr-pad">${t.sc === undefined && C.lib?.sc?.running ? 'looking it up…' : 'not looked up yet'} · <button class="chip mini" data-ci="fetch">FETCH FROM SOUNDCLOUD</button></div>`}
      <div class="ci-fix"><input class="rt-input" id="ci-url" placeholder="${s ? 'wrong match? paste the right soundcloud link' : 'or paste its soundcloud link'}" spellcheck="false" /><button class="act" data-ci="url">LINK</button></div>
      <div class="ci-sec">REKORDBOX</div>
      <div class="core-rows ci-rows">
        ${row('drop', f?.d1 > 0 ? `bar ${f.d1} · ${fmtLen(f.d1ms / 1000)}${f.fx1 ? ' ✓ yours' : ''}${f.d2 > 0 ? ` · 2nd at bar ${f.d2} · ${fmtLen(f.d2ms / 1000)}${f.fx2 ? ' ✓' : ''}` : ''}` : '')}${row('energy', f ? `${f.e}%` : '')}
        ${row('genre', esc(t.genre || ''))}${row('label', esc(t.label || ''))}${row('remixer', esc(t.remixer || ''))}${row('comment', esc(t.comment || ''))}
        ${row('added', esc(String(t.added || '').slice(0, 10)))}${row('plays', plays(t) || '')}${row('file', `${esc((t.path || '').split(/[\\/]/).pop())}`)}${row('quality', [t.bitrate ? `${t.bitrate} kbps` : '', t.rate ? `${(t.rate / 1000).toFixed(1)} kHz` : '', sizeMb].filter(Boolean).join(' · '))}
      </div>
      <div class="ci-btns"><button class="act" data-ci="reveal">SHOW IN FOLDER</button></div>`;
  }
  $('#cr-info').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ci]');
    const t = focusTrack();
    if (!b || !t) return;
    const a = b.dataset.ci;
    if (a === 'play') { const i = C.list.findIndex((x) => x.id === t.id); i >= 0 ? playFrom(C.list, i) : playId(t.id); }
    else if (a === 'next') { C.queue.splice(C.qi + 1, 0, t.id); renderQueue(); toast('PLAYS NEXT'); }
    else if (a === 'A' || a === 'B') window.CrateDJ?.load(a, t);
    else if (a === 'sc') hs.call('scOpen', t.sc.url);
    else if (a === 'buy') hs.call('scOpen', t.sc.buy.url);
    else if (a === 'artist') hs.call('scOpen', t.sc.userUrl);
    else if (a === 'reveal') hs.call('libReveal', t.id);
    else if (a === 'fetch') startFetch();
    else if (a === 'url') {
      const url = $('#ci-url').value.trim();
      if (!url) return toast('PASTE A SOUNDCLOUD TRACK LINK', true);
      try { t.sc = await hs.call('scSetUrl', t.id, url); if (t.sc?.art) t.art = true; toast('LINKED TO SOUNDCLOUD'); renderInfo(); renderRows(true); }
      catch (er) { toast(er.message, true); }
    }
  });

  // DOUBLES: what layers well on top of a track. In dubstep a double is two tunes played at once, so beyond
  // the usual key + tempo it matters that the phrases line up (drops on the same 8-bar grid), that the two
  // aren't fighting in the same register, that the energy is comparable, and what you've paired yourself.
  function doubles(t) {
    const fa = C.feats[t.id], ca = camelot(t.key);
    if (!t.bpm) return [];
    const myPairs = new Map(), inDoubles = new Set();
    for (const p of doublesPlaylists()) p.tracks.forEach((id, i) => { inDoubles.add(id); if (id === t.id) [p.tracks[i - 1], p.tracks[i + 1]].forEach((x) => x && myPairs.set(x, p.name)); });
    const hist = new Set();
    for (const h of C.lib.history || []) h.tracks.forEach((id, i) => { if (id === t.id) [h.tracks[i - 1], h.tracks[i + 1]].forEach((x) => x && hist.add(x)); });
    const tagsA = new Set([...(t.sc?.tags || []), t.sc?.genre, t.genre].filter(Boolean).map((x) => x.toLowerCase()));
    const out = [];
    for (const o of C.lib.tracks) {
      if (o.id === t.id || !o.exists || !o.bpm) continue;
      let r = o.bpm / t.bpm;
      if (r > 1.6) r /= 2; else if (r < 0.625) r *= 2;
      const tempoDiff = Math.abs(r - 1) * 100;
      if (tempoDiff > 4) continue;
      const why = [];
      let s = 0;
      // tempo: doubles want the same BPM; a nudge is fine
      s += tempoDiff < 0.3 ? 25 : tempoDiff < 1.5 ? 17 : 8;
      why.push(tempoDiff < 0.3 ? `${Math.round(o.bpm)} = ${Math.round(t.bpm)} BPM` : `${tempoDiff.toFixed(1)}% tempo`);
      // key: same or relative is best; lots of riddim is near-atonal, so a clash costs points rather than ruling it out
      const k = keyDist(ca, camelot(o.key));
      if (k) {
        if (k.d === 0 && !k.rel) { s += 25; why.push('same key'); }
        else if (k.d === 0) { s += 19; why.push('relative key'); }
        else if (k.d === 1 && !k.rel) { s += 15; why.push('next key'); }
        else if (k.d === 2) s += 6;
        else s -= 4;
      } else s += 8;
      // phrasing: drops on the 8-bar grid line up when you start them together on a phrase
      const fb = C.feats[o.id];
      if (fa?.d1 > 0 && fb?.d1 > 0) {
        if (fa.d1 % 8 === 0 && fb.d1 % 8 === 0) { s += 12; why.push(fa.d1 === fb.d1 ? `both drop at bar ${fa.d1}` : 'drops on the phrase'); }
        else s += 4;
        // energy: a 90% banger over a 40% intro tune sounds lopsided
        const de = Math.abs(fa.e - fb.e);
        s += de < 8 ? 10 : de < 18 ? 6 : 0;
        // register: different colour mixes stack cleaner than two identical ones
        const diff = Math.abs(fa.lo - fb.lo) + Math.abs(fa.mi - fb.mi) + Math.abs(fa.hi - fb.hi);
        if (diff >= 14) { s += 10; why.push('contrasting textures'); } else if (diff >= 7) s += 5;
      }
      // community + your own taste
      const tagsB = [...(o.sc?.tags || []), o.sc?.genre, o.genre].filter(Boolean).map((x) => x.toLowerCase());
      const shared = tagsB.filter((x) => tagsA.has(x) && !/^(dubstep|edm|electronic|bass)$/.test(x));
      if (shared.length) { s += Math.min(8, shared.length * 4); why.push(`both ${shared[0]}`); }
      if (myPairs.has(o.id)) { s += 30; why.push(`paired in ${myPairs.get(o.id)}`); }
      else if (inDoubles.has(o.id)) { s += 6; why.push('in your doubles lists'); }
      if (hist.has(o.id)) { s += 12; why.push('played together before'); }
      out.push({ o, s, why, tempoDiff });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 25);
  }
  function renderDoubles() {
    const t = focusTrack();
    if (!t || !C.lib) { $('#cr-dbl').innerHTML = '<div class="dim tiny cr-pad">select or play a track</div>'; return; }
    $('#cr-dbl-for').innerHTML = `doubles for <b>${esc(names(t).title)}</b>${Object.keys(C.feats).length ? '' : ' · <span class="dim">reading drops…</span>'}`;
    const list = doubles(t);
    $('#cr-dbl').innerHTML = list.length ? list.map(({ o, s, why }) => { const n = names(o);
      return `<div class="cr-q dbl" data-id="${esc(o.id)}">${art(o, 'cr-art sm')}<div><b>${esc(n.title)}</b><span>${o.bpm.toFixed(0)} · <i class="kb" style="--kh:${keyHue(camelot(o.key))}">${esc(keyLabel(o))}</i> · ${esc(why.slice(0, 3).join(' · '))}</span></div><span class="dsc" title="match score">${Math.max(1, Math.min(99, Math.round(s)))}</span><button class="x add" title="${C.mode === 'dj' ? 'Load on the other deck' : 'Play next'}">＋</button></div>`; }).join('')
      : '<div class="dim tiny cr-pad">nothing at this tempo in your library yet</div>';
  }
  $('#cr-dbl').addEventListener('click', (e) => {
    const q = e.target.closest('.cr-q');
    if (!q) return;
    const o = C.byId.get(q.dataset.id);
    if (e.target.classList.contains('add')) {
      if (C.mode === 'dj') return window.CrateDJ?.loadFree(o);
      C.queue.splice(C.qi + 1, 0, o.id); renderQueue(); toast('PLAYS NEXT'); return;
    }
    C.sel = o.id; renderRows(true);
    $('#cr-stabs [data-side="info"]').click();
  });

  function renderQueue() {
    const ids = C.queue.slice(C.qi + 1, C.qi + 41);
    $('#cr-queue').innerHTML = ids.length ? ids.map((id, k) => { const t = C.byId.get(id); if (!t) return ''; const n = names(t);
      return `<div class="cr-q" data-q="${C.qi + 1 + k}">${art(t, 'cr-art sm')}<div><b>${esc(n.title)}</b><span>${t.bpm ? Math.round(t.bpm) + ' · ' : ''}${esc(keyLabel(t))}</span></div><button class="x" title="Remove">✕</button></div>`; }).join('')
      : '<div class="dim tiny cr-pad">nothing queued · right-click a track to add it</div>';
  }
  $('#cr-queue').addEventListener('click', (e) => {
    const q = e.target.closest('.cr-q');
    if (!q) return;
    const i = +q.dataset.q;
    if (e.target.classList.contains('x')) { C.queue.splice(i, 1); return renderQueue(); }
    C.qi = i; playId(C.queue[i]);
  });
  $('#cr-qclear').addEventListener('click', () => { C.queue = C.queue.slice(0, C.qi + 1); renderQueue(); });
  function renderMix() {
    const t = C.cur;
    if (!t || !C.lib) return;
    const cam = camelot(t.key);
    const scored = [];
    for (const o of C.lib.tracks) {
      if (o.id === t.id || !o.exists) continue;
      const oc = camelot(o.key);
      const k = keyDist(cam, oc);
      if (!k || !(k.d === 0 || (k.d === 1 && !k.rel)) || !t.bpm || !o.bpm) continue;
      let ratio = o.bpm / t.bpm;
      if (ratio > 1.6) ratio /= 2; else if (ratio < 0.625) ratio *= 2;
      const diff = Math.abs(ratio - 1) * 100;
      if (diff > 6) continue;
      scored.push({ o, diff, same: oc === cam });
    }
    scored.sort((a, b) => a.diff - b.diff + (b.same - a.same) * 0.8);
    $('#cr-mix').innerHTML = scored.length ? scored.slice(0, 20).map(({ o, diff }) => { const n = names(o), oc = camelot(o.key);
      return `<div class="cr-q" data-id="${esc(o.id)}">${art(o, 'cr-art sm')}<div><b>${esc(n.title)}</b><span>${o.bpm.toFixed(0)} BPM ${diff < 0.5 ? '= ' : `(${(o.bpm > t.bpm ? '+' : '−') + diff.toFixed(1)}%) `}· <i class="kb" style="--kh:${keyHue(oc)}">${esc(keyLabel(o))}</i></span></div><button class="x add" title="Play next">＋</button></div>`; }).join('')
      : `<div class="dim tiny cr-pad">${cam ? 'no key + tempo matches in your library' : 'this track has no key: analyse it in rekordbox'}</div>`;
  }
  $('#cr-mix').addEventListener('click', (e) => {
    const q = e.target.closest('.cr-q');
    if (!q) return;
    if (e.target.classList.contains('add')) { C.queue.splice(C.qi + 1, 0, q.dataset.id); renderQueue(); toast('PLAYS NEXT'); return; }
    C.queue.splice(C.qi + 1, 0, q.dataset.id); C.qi++; playId(q.dataset.id);
  });

  // ---------------- SoundCloud lookups ----------------
  async function startFetch(redo = false) {
    try { const s = await hs.call('scFetch', { redo }); toast(s.total ? `LOOKING UP ${s.total} TRACKS ON SOUNDCLOUD · ABOUT ${Math.ceil(s.total * 1.1 / 60)} MIN` : 'EVERY TRACK IS ALREADY LOOKED UP'); }
    catch (e) { toast(e.message, true); }
  }
  // Results land in the library on the next load. While a scan runs, CRATE reloads every 25 tracks if it's
  // on screen; from any other page it's marked stale and reloads the moment you look at it (or when done).
  let scLast = null, stale = false;
  hs.on('sc-progress', (p) => {
    scLast = p;
    if (C.lib) C.lib.sc = p;
    $('#cr-src').textContent = p.running ? `SOUNDCLOUD ${p.done}/${p.total}` : C.lib ? `REKORDBOX · ${C.lib.tracks.length}` : '';
    renderScStatus();
    if (p.done) stale = true;
    if (!C.lib) return;
    if (p.finished) {
      stale = false;
      load();
      toast(p.error ? `SOUNDCLOUD STOPPED: ${p.error}` : `SOUNDCLOUD DONE · ${p.matched} TRACKS HAVE ARTWORK + INFO`);
    } else if (HS.view === 'crate' && p.done % 25 === 0) { stale = false; load(); }
  });

  // ---------------- ⇩ GET: free SoundCloud track → folder → rekordbox ----------------
  const G = { info: null, jobs: [], queue: 0 };
  const STATE = { klickaud: '◌ WAITING FOR YOU IN KLICKAUD', downloading: '⇩ DOWNLOADING', tagging: '✎ TAGGING', queued: '◷ SAVED · REKORDBOX NEXT', done: '✓ IN REKORDBOX', failed: '✕ FAILED', cancelled: '— CANCELLED' };
  function renderJobs() {
    $('#get-queue').textContent = G.queue ? `${G.queue} waiting for rekordbox to close` : '';
    $('#get-jobs').innerHTML = G.jobs.length ? G.jobs.map((j) => `<div class="get-job s-${j.state}"><div><b>${esc(j.title)}</b><div class="dim tiny">${esc(j.note || '')}${j.state === 'downloading' && j.pct ? ` ${j.pct}%` : ''}</div></div><em>${STATE[j.state] || j.state}</em></div>`).join('')
      : '<div class="dim tiny cr-pad">nothing yet</div>';
  }
  async function openGet() {
    $('#get-modal').classList.remove('hidden');
    $('#get-url').focus();
    try { const r = await hs.call('grabJobs'); G.jobs = r.jobs; G.queue = r.queue; } catch {}
    renderJobs();
  }
  async function fillFolders(pick) {
    const f = await hs.call('grabFolders');
    const sel = $('#get-folder');
    sel.innerHTML = f.folders.map((x) => `<option value="${esc(x.path)}" title="${esc(x.path)}">${esc(x.name)}</option>`).join('') +
      '<option value="__new">＋ NEW FOLDER…</option>' + (pick && !f.folders.some((x) => x.path === pick) ? `<option value="${esc(pick)}">${esc(pick.split(/[\\/]/).pop())}</option>` : '');
    if (pick) sel.value = pick;
    folderChanged();
  }
  function folderChanged() {
    const isNew = $('#get-folder').value === '__new';
    $('#get-new').classList.toggle('hidden', !isNew);
    const name = isNew ? $('#get-new').value.trim() : ($('#get-folder').value.split(/[\\/]/).pop() || '');
    $('#get-pl').textContent = name ? `rekordbox playlist: "${name}"` : '';
    if (isNew) $('#get-new').focus();
  }
  async function lookUp() {
    const url = $('#get-url').value.trim();
    if (!url) return;
    const card = $('#get-card');
    card.classList.remove('hidden');
    card.innerHTML = '<div class="dim">looking it up…</div>';
    $('#get-dest').classList.add('hidden');
    try {
      const i = G.info = await hs.call('grabInfo', url);
      card.innerHTML = `${i.art ? `<img src="${esc(i.art)}" alt="">` : '<i class="cr-art gen"></i>'}<div><div class="get-t">${esc(i.title)}</div><div class="get-a">${esc(i.artist)}</div>
        <div class="dim tiny">${esc([i.genre, i.year, i.label, fmtLen(i.len)].filter(Boolean).join(' · '))}</div>
        <div class="get-badge ${i.free ? 'ok' : 'bad'}">${i.free ? 'FREE DOWNLOAD' : 'NOT A FREE DOWNLOAD'} · ${esc(i.why)}</div>
        ${!i.free && i.buy ? '<button class="chip mini" id="get-buy">OPEN BUY LINK</button>' : ''}</div>`;
      $('#get-dest').classList.remove('hidden');
      await fillFolders($('#get-folder').value && $('#get-folder').value !== '__new' ? $('#get-folder').value : null);
    } catch (e) { G.info = null; card.innerHTML = `<div class="bad">${esc(e.message)}</div>`; }
  }
  $('#cr-get').addEventListener('click', openGet);
  $('#get-close').addEventListener('click', () => $('#get-modal').classList.add('hidden'));
  $('#get-modal').addEventListener('click', (e) => { if (e.target.id === 'get-modal') $('#get-modal').classList.add('hidden'); });
  $('#get-look').addEventListener('click', lookUp);
  $('#get-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookUp(); });
  $('#get-url').addEventListener('paste', () => setTimeout(lookUp, 50));
  $('#get-card').addEventListener('click', (e) => { if (e.target.id === 'get-buy' && G.info?.buy) hs.call('grabBuy', G.info.buy); });
  $('#get-folder').addEventListener('change', folderChanged);
  $('#get-new').addEventListener('input', folderChanged);
  $('#get-browse').addEventListener('click', async () => { const p = await hs.call('grabBrowse'); if (p) fillFolders(p); });
  $('#get-go').addEventListener('click', async () => {
    if (!G.info) return;
    const v = $('#get-folder').value;
    try {
      await hs.call('grabStart', { url: G.info.url, folder: v === '__new' ? null : v, newFolder: v === '__new' ? $('#get-new').value : null });
      $('#get-url').value = ''; G.info = null;
      $('#get-card').classList.add('hidden'); $('#get-dest').classList.add('hidden');
    } catch (e) { toast(e.message, true); }
  });
  hs.on('grab-progress', (p) => {
    G.jobs = p.jobs || G.jobs; G.queue = p.queue ?? G.queue;
    renderJobs();
    if (p.rekordbox) { toast(`ADDED ${p.rekordbox} TRACK${p.rekordbox > 1 ? 'S' : ''} TO REKORDBOX`); if (HS.view === 'crate') load(true); else stale = true; }
  });

  // ---------------- SETTINGS → CRATE ----------------
  function renderScStatus() {
    const el = document.getElementById('scs-status');
    if (!el) return;
    const p = scLast || C.lib?.sc || {};
    el.innerHTML = p.running ? `<b>looking up ${p.done} / ${p.total}</b><br><span class="dim">${esc(p.current || '')}</span>${p.note ? `<br>${esc(p.note)}` : ''}`
      : `${p.matched || 0} tracks matched · ${p.none || 0} not found${p.error ? ` · <span class="bad">${esc(p.error)}</span>` : ''}`;
    document.getElementById('scs-go')?.classList.toggle('hidden', !!p.running);
    document.getElementById('scs-stop')?.classList.toggle('hidden', !p.running);
  }
  function renderSettings() {
    const box = document.getElementById('set-crate');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `<div class="set-grid">
      <div class="panel set-card"><div class="panel-head"><span class="glyph">☁</span> SOUNDCLOUD METADATA</div><div class="set-body">
        <p class="dim tiny">Looks every track up on SoundCloud by its name and length, and brings back the artwork, release date, genre, tags, label, plays, likes and buy / free-download links. About one track a second; it carries on in the background and new tracks are looked up on their own afterwards. Your files and rekordbox are never changed.</p>
        <div class="sc-status" id="scs-status"></div>
        <div class="core-actions" style="padding:4px 0 0"><button class="act" id="scs-go">FETCH FOR MY LIBRARY</button><button class="act hidden" id="scs-stop">STOP</button><button class="act" id="scs-redo" title="Look everything up again (keeps links you pasted yourself)">REDO ALL</button></div>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">⇄</span> TRANSITIONS</div><div class="set-body">${xfadeHtml('sx')}</div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">◎</span> DISPLAY</div><div class="set-body">
        <label class="set-l">KEYS</label><div class="seg small" id="sx-keys"><button data-v="camelot">CAMELOT</button><button data-v="musical">MUSICAL</button></div>
        <label class="check"><input type="checkbox" id="sx-clean" /> clean up titles (display only)</label>
      </div></div>
    </div>`;
    bindXfade(box, 'sx');
    box.querySelector('#scs-go').addEventListener('click', () => startFetch(false));
    box.querySelector('#scs-redo').addEventListener('click', () => startFetch(true));
    box.querySelector('#scs-stop').addEventListener('click', () => hs.call('scStop'));
    box.querySelector('#sx-keys').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { C.keyFmt = b.dataset.v; savePrefs(); syncSettings(); syncTools(); renderRows(true); } });
    box.querySelector('#sx-clean').addEventListener('change', (e) => { C.clean = e.target.checked; savePrefs(); syncTools(); renderRows(true); });
    syncSettings();
    renderScStatus();
  }
  function syncSettings() {
    $$('#sx-keys button').forEach((b) => b.classList.toggle('on', b.dataset.v === C.keyFmt));
    const c = document.getElementById('sx-clean');
    if (c) c.checked = C.clean;
  }

  // ---------------- keys ----------------
  window.addEventListener('keydown', (e) => {
    if (HS.view !== 'crate' || HS.inVJ() || C.mode !== 'player' || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { cancelMix(true); au().currentTime = Math.min(au().duration || 0, au().currentTime + (e.shiftKey ? 30 : 5)); }
    else if (e.key === 'ArrowLeft') { cancelMix(true); au().currentTime = Math.max(0, au().currentTime - (e.shiftKey ? 30 : 5)); }
    else if (e.key === 'n' || e.key === 'N') next();
    else if (e.key === 'p' || e.key === 'P') prev();
    else if (/^[1-8]$/.test(e.key) && C.cur) { const c = (C.cur.cues || []).find((x) => x[1] === +e.key); if (c) { au().currentTime = c[0] / 1000; if (au().paused) au().play(); } }
    else if (e.key === '/') { e.preventDefault(); $('#cr-search').focus(); }
  });

  // shared with the DJ page
  window.CRATE = { C, E, names, keyLabel, camelot, keyHue, art, fmtLen, fetchWave, trackUrl, renderRows, renderSide, toggle, next, prev, renderPlayer, doubles, CUE_COLORS, setMode };

  syncTools();
  let loaded = false;
  HS.onView((v) => {
    if (v === 'crate' || v === 'settings') {
      if (!loaded) { loaded = true; load(); loadOutputs(); }
      else if (v === 'crate' && stale) { stale = false; load(); }
      else if (v === 'crate') { renderRows(true); drawWave(); }
    }
  });
  // new songs in Music (or tagged from Downloads) show up on their own
  hs.on('crate-changed', () => { if (loaded) load(); });
  hs.on('tagger', (s) => { C.tagger = s; if (C.lib) renderNav(); });
  hs.on('tagged', (e) => toast(`TAGGED · ${e.newName.replace(/\.[^.]+$/, '')}`));
  hs.on('core', (s) => { if (s.state === 'online' && loaded && C.lib && C.lib.source !== 'rekordbox') load(); });
  try { if (localStorage.getItem('crateMode') === 'dj') setTimeout(() => setMode('dj'), 0); } catch {}
})();
