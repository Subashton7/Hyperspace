// HYPERSPACE on the phone (served by the phone link). Two modes, switched at the top:
//   ⌨ LAPTOP  HOME (the laptop's stats) · MUSIC · CONTROL · FULL (the complete desktop interface)
//   ▣ PHONE   PHONE (this phone) · MUSIC · VJ · LAPTOP (the laptop's stats + controls, when it's around)
// MUSIC keeps its ON PHONE / ON LAPTOP switch in both. In PHONE mode the library is saved on the phone
// (SYNC copies every track and cover over Wi-Fi), so with the app on the home screen it plays with the laptop
// off. That needs the secure address https://hyperspace.local (iPhones only keep web apps that work offline
// from secure sites): the MOBILE MODE card walks through the one-time setup.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v) => (v == null || isNaN(v) ? '--' : `${Math.round(v)}%`);
  const bytes = (b) => { if (b == null || isNaN(b)) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(b >= 100 || !i ? 0 : 1)} ${u[i]}`; };
  const core = (cmd, args) => hs.call('core', cmd, args);
  let toastT;
  const toast = (m, bad) => { const t = $('#toast'); t.textContent = m; t.className = `show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 2600); };
  const D = { perf: null, tele: null, vpn: null };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const SECURE = location.protocol === 'https:' && 'caches' in window;
  const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const QS = new URLSearchParams(location.search);
  // Brave can't add web apps to the home screen, so its icon is a Shortcuts shortcut opening this page with
  // ?app=brave: that counts as installed. ?via= carries the browser picked on the MOBILE MODE card across to
  // the secure address (each address keeps its own settings)
  const SHORTCUT = QS.get('app') === 'brave';
  const INSTALLED = STANDALONE || SHORTCUT;
  if (QS.get('via')) store.set('setup-browser', QS.get('via'));

  // ---------------- the secure, offline-capable app ----------------
  if (SECURE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // Add to Home Screen picks up this description, with the pairing key, so the installed app starts paired
  if (SECURE && hs.key?.()) $('#manifest').href = `manifest.webmanifest?k=${encodeURIComponent(hs.key())}`;

  // ---------------- modes + tabs ----------------
  const TABS = {
    laptop: [['home', '◈', 'HOME'], ['music', '◎', 'MUSIC'], ['control', '⚙', 'CONTROL'], ['full', '⊞', 'FULL']],
    phone: [['phone', '▣', 'PHONE'], ['music', '◎', 'MUSIC'], ['vj', '✺', 'VJ'], ['laptop', '⌨', 'LAPTOP']],
  };
  const qsMode = QS.get('mode');
  let mode = qsMode || store.get('phone-mode', INSTALLED ? 'phone' : 'laptop');
  let tab = null;
  function setMode(m) {
    mode = m; store.set('phone-mode', m);
    $$('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#tabs').innerHTML = TABS[m].map(([id, ic, label]) => (id === 'full' ? `<a href="index.html"><span>${ic}</span>${label}</a>` : `<button data-tab="${id}"><span>${ic}</span>${label}</button>`)).join('');
    $('#top-vpn').classList.toggle('hidden', m === 'phone' && !laptopUp);
    const keep = TABS[m].some(([id]) => id === tab) ? tab : TABS[m][0][0];
    show(store.get(`phone-tab-${m}`, keep));
    renderSetup();
  }
  // a tab shows one or more pages (LAPTOP in phone mode = the laptop's stats + its controls)
  const PAGES = { laptop: ['home', 'control'] };
  function show(t) {
    if (!TABS[mode].some(([id]) => id === t)) t = TABS[mode][0][0];
    tab = t; store.set(`phone-tab-${mode}`, t);
    $$('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    const pages = PAGES[t] || [t];
    $$('.page').forEach((p) => p.classList.toggle('on', pages.includes(p.dataset.page)));
    $('#away').classList.toggle('hidden', !(t === 'laptop' && !laptopUp));
    $('#setup').classList.toggle('off-tab', t !== TABS[mode][0][0]); // the setup card lives on the first tab only
    if (t !== 'music') $('#save-sheet').classList.add('hidden');
    if (t === 'music') loadLib();
    if (t === 'control' || t === 'laptop') refreshControl();
    if (t === 'phone') renderVitals();
    if (t === 'vj') { PhoneVJ.start(); $('#vj-name').textContent = PhoneVJ.name(); } else PhoneVJ.stop();
    $('main').scrollTop = 0;
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  $('#mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b && b.dataset.m !== mode) setMode(b.dataset.m); });

  // ---------------- is the laptop around? ----------------
  let laptopUp = false, ping = null;
  function setUp(v) {
    if (v === laptopUp) return;
    laptopUp = v;
    $('#top-link').classList.toggle('on', v);
    $('#top-vpn').classList.toggle('hidden', mode === 'phone' && !v);
    $('#away').classList.toggle('hidden', !(tab === 'laptop' && !v));
    renderList(); renderPlayer(); renderVitals();
    if (v) { if (mode === 'phone' && SECURE && store.get('auto-sync', true)) setTimeout(() => sync(false), 3000); }
  }
  async function tick() {
    const t0 = performance.now();
    try { D.perf = await hs.call('perf'); ping = Math.round(performance.now() - t0); setUp(true); } catch { setUp(false); }
    renderHome();
    if (tab === 'phone') renderVitals();
  }
  setInterval(tick, 2500);

  // ---------------- HOME (the laptop) ----------------
  const tiles = [
    ['vpn', 'wide', '⛨ VPN'], ['temps', 'wide', '☢ TEMPS'], ['cpu', '', '✺ CPU'], ['gpu', '', '◈ GPU'], ['ram', '', '▤ MEMORY'],
    ['fans', '', '❋ FANS'], ['net', 'wide', '⇅ NETWORK'], ['batt', '', '⌁ BATTERY'], ['up', '', '⏱ UPTIME'],
  ];
  $('#home').innerHTML = tiles.map(([id, w, h]) => `<div class="tile ${w}" id="t-${id}"><div class="h">${h} <em></em></div><div class="big">--</div><div class="sub"></div></div>`).join('');
  const T = (id) => ({ el: $(`#t-${id}`), big: $(`#t-${id} .big`), sub: $(`#t-${id} .sub`), em: $(`#t-${id} em`) });
  function heat(el, v, lim) { el.classList.toggle('hot', v != null && v >= lim); el.classList.toggle('warm', v != null && v >= lim - 8 && v < lim); }
  function renderHome() {
    const p = D.perf, t = D.tele, v = D.vpn;
    const vp = T('vpn');
    vp.el.classList.toggle('vpn-on', !!v?.on); vp.el.classList.toggle('vpn-off', !!v && !v.on);
    vp.big.textContent = !v ? '…' : v.on ? `${v.provider || 'VPN'} ON` : 'NOT PROTECTED';
    vp.sub.textContent = !v ? '' : v.on ? `${v.adapter} · tunnel ${v.ip}` : v.apps?.length ? `${v.apps.join(', ')} open, not connected` : 'no VPN connected';
    const pill = $('#top-vpn');
    pill.className = `pill vpn ${v ? (v.on ? 'on' : 'off') : ''}${mode === 'phone' && !laptopUp ? ' hidden' : ''}`;
    pill.textContent = !v ? 'VPN' : v.on ? '⛨ VPN' : '⚠ VPN';
    pill.title = !v ? '' : v.on ? `${v.provider || 'VPN'} on` : 'the laptop is not on a VPN';
    const c = t?.cpu?.temp, g = t?.gpuTemp, a = t?.alarm, tm = T('temps');
    tm.big.innerHTML = `<span class="tc">${c != null ? c + '°' : '--'}</span> <small>CPU</small> &nbsp; <span class="tg">${g != null ? g + '°' : '--'}</span> <small>GPU</small>`;
    heat($('.tc', tm.el), c, a?.cpuLimit ?? 95); heat($('.tg', tm.el), g, a?.gpuLimit ?? 87);
    tm.sub.textContent = a?.active ? '⚠ OVERHEAT PROTOCOL ACTIVE' : '';
    if (p) {
      const cpu = T('cpu'); cpu.big.textContent = pct(p.cpu); cpu.sub.textContent = t?.cpu?.clock ? `${(t.cpu.clock / 1000).toFixed(1)} GHz` : '';
      const gpu = T('gpu'); gpu.big.textContent = pct(t?.gpu?.util ?? p.gpu); gpu.sub.textContent = t?.gpu?.memUsed ? `VRAM ${bytes(t.gpu.memUsed)}` : '';
      const ram = T('ram'); ram.big.textContent = pct((p.mem.used / p.mem.total) * 100); ram.sub.textContent = `${bytes(p.mem.used)} / ${bytes(p.mem.total)}`;
      const net = T('net'); net.big.textContent = `↓ ${bytes(p.net?.rx)}/s`; net.sub.textContent = `↑ ${bytes(p.net?.tx)}/s`;
      const b = T('batt'); b.big.textContent = p.battery ? pct(p.battery.pct) : '—'; b.sub.textContent = p.battery ? (p.battery.charging ? '⚡ charging' : 'on battery') : 'no battery';
      const u = T('up'), s = p.uptime || 0; u.big.textContent = `${Math.floor(s / 86400) ? Math.floor(s / 86400) + 'd ' : ''}${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    }
    const f = T('fans');
    f.big.textContent = t?.cpu?.fanRpm != null ? `${t.cpu.fanRpm}` : '--';
    f.sub.textContent = `GPU ${t?.gpuFanRpm ?? '--'} rpm`; f.em.textContent = (t?.fans?.mode || '').toUpperCase();
    $('#fan-rpm').textContent = t?.cpu?.fanRpm != null ? `${t.cpu.fanRpm} / ${t.gpuFanRpm ?? '--'} rpm` : '';
  }
  hs.on('telemetry', (t) => { D.tele = t; });
  hs.on('vpn', (v) => { D.vpn = v; renderHome(); });

  // ---------------- the library: from the laptop, or saved on the phone ----------------
  const CAM = { Abm: '1A', 'G#m': '1A', Ebm: '2A', 'D#m': '2A', Bbm: '3A', 'A#m': '3A', Fm: '4A', Cm: '5A', Gm: '6A', Dm: '7A', Am: '8A', Em: '9A', Bm: '10A', 'F#m': '11A', Gbm: '11A', Dbm: '12A', 'C#m': '12A',
    B: '1B', 'F#': '2B', Gb: '2B', Db: '3B', 'C#': '3B', Ab: '4B', 'G#': '4B', Eb: '5B', 'D#': '5B', Bb: '6B', 'A#': '6B', F: '7B', C: '8B', G: '9B', D: '10B', A: '11B', E: '12B' };
  const cam = (k) => CAM[(k || '').trim()] || '';
  const clean = (s) => String(s || '').replace(/_/g, ' ').replace(/\s*(klickaud|\(?free\s*(dl|download)\)?|\[free\s*(dl|download)\])\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  const M = { tracks: [], byId: new Map(), playlists: [], view: [], shown: 120, out: store.get('phone-out', 'phone'), queue: [], qi: -1, laptop: null, saved: new Set() };
  const trackKey = (id) => `/media/track/${encodeURIComponent(id)}`;
  const artKey = (id) => `/media/art/${encodeURIComponent(id)}`;
  const music = () => (SECURE ? caches.open('hs-music') : null);

  async function savedIds() {
    if (!SECURE) return new Set();
    const c = await music();
    return new Set((await c.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.startsWith('/media/track/')).map((p) => decodeURIComponent(p.slice(13))));
  }
  function useLib(L) {
    M.tracks = L.tracks.map((t) => ({ ...t, title: clean(t.title), artist: clean(t.artist), cam: cam(t.key) }));
    M.byId = new Map(M.tracks.map((t) => [t.id, t]));
    M.playlists = L.playlists || [];
    const kids = new Map();
    for (const p of M.playlists) { const k = p.parent || 'root'; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(p); }
    const opts = [];
    const walk = (parent, depth) => (kids.get(parent) || []).forEach((p) => {
      if (p.kind === 1) { opts.push(`<option disabled>${'  '.repeat(depth)}▸ ${esc(p.name)}</option>`); walk(p.id, depth + 1); }
      else opts.push(`<option value="${esc(p.id)}">${'  '.repeat(depth)}${esc(p.name)} (${p.tracks.length})</option>`);
    });
    walk('root', 0);
    $('#pl').innerHTML = '<option value="">ALL TRACKS</option>' + opts.join('');
    $('#pl').value = store.get('phone-pl', '');
    filter();
  }
  let libLoading = null;
  function loadLib(fresh = false) {
    if (libLoading && !fresh) return libLoading;
    libLoading = (async () => {
      M.saved = await savedIds().catch(() => new Set());
      try {
        const L = await hs.call('libLite');
        useLib(L);
        if (SECURE) (await caches.open('hs-meta')).put('/meta/library', new Response(JSON.stringify(L), { headers: { 'Content-Type': 'application/json' } }));
      } catch (e) {
        // the laptop is away: the copy saved at the last sync
        const r = SECURE ? await (await caches.open('hs-meta')).match('/meta/library') : null;
        if (r) useLib(await r.json());
        else { $('#count').textContent = SECURE ? 'the laptop is away and nothing is saved on this phone yet: SYNC while on its Wi-Fi' : `couldn't reach the laptop (${e.message})`; libLoading = null; }
      }
    })();
    return libLoading;
  }
  function filter() {
    const pl = $('#pl').value;
    let list = pl ? (M.playlists.find((p) => p.id === pl)?.tracks || []).map((id) => M.byId.get(id)).filter(Boolean) : [...M.tracks].sort((a, b) => String(b.added).localeCompare(String(a.added)));
    const q = $('#q').value.trim().toLowerCase();
    for (const tok of q.split(/\s+/).filter(Boolean)) {
      let m;
      if ((m = tok.match(/^bpm:(\d+)(?:-(\d+))?$/))) { const lo = +m[1], hi = m[2] ? +m[2] : null; list = list.filter((t) => (hi ? t.bpm >= lo && t.bpm <= hi : Math.abs(t.bpm - lo) <= 1.5)); }
      else if ((m = tok.match(/^key:(\d{1,2}[ab])$/))) list = list.filter((t) => t.cam.toLowerCase() === m[1]);
      else if (tok === 'saved' || tok === 'offline') list = list.filter((t) => M.saved.has(t.id));
      else list = list.filter((t) => `${t.title} ${t.artist} ${t.genre || ''}`.toLowerCase().includes(tok));
    }
    M.view = list;
    M.shown = 120;
    renderList();
  }
  function renderList() {
    if (!M.tracks.length) return;
    const cur = curId(), off = !laptopUp;
    const nSaved = M.view.filter((t) => M.saved.has(t.id)).length;
    $('#count').textContent = `${M.view.length} track${M.view.length === 1 ? '' : 's'}${SECURE ? ` · ${nSaved} on this phone` : ''}${M.out === 'laptop' ? ' · tap to play on the laptop' : off ? ' · laptop away: saved tracks play' : ''}`;
    $('#save-files').textContent = M.view.length === 1 ? '⇩ SAVE THIS TRACK TO FILES' : `⇩ SAVE THESE ${M.view.length} TO FILES`;
    $('#list').innerHTML = M.view.slice(0, M.shown).map((t, i) => {
      const has = M.saved.has(t.id), dead = off && !has;
      return `<div class="row${t.id === cur ? ' cur' : ''}${dead ? ' dead' : ''}" data-i="${i}">
        <i class="art" ${t.art ? `style="background-image:url('${hs.media('art', t.id)}')"` : ''}></i>
        <div class="n"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || '')}</div></div>
        <div class="k"><b>${t.bpm ? Math.round(t.bpm) : ''}</b><br>${esc(t.cam)}${SECURE ? `<br><i class="sv${has ? ' on' : ''}">${has ? '●' : '○'}</i>` : ''}</div></div>`;
    }).join('') + (M.view.length > M.shown ? `<button class="more">SHOW ${Math.min(200, M.view.length - M.shown)} MORE</button>` : '');
  }
  let qT;
  $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(filter, 180); });
  $('#pl').addEventListener('change', () => { store.set('phone-pl', $('#pl').value); filter(); });
  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('.more')) { M.shown += 200; return renderList(); }
    const row = e.target.closest('.row');
    if (!row) return;
    if (held) { held = false; return; } // that was a hold: SAVE TO FILES, not play
    const i = +row.dataset.i, t = M.view[i];
    if (M.out === 'laptop') {
      if (!laptopUp) return toast('THE LAPTOP IS AWAY', true);
      const ids = M.view.slice(Math.max(0, i - 50), i + 250).map((x) => x.id);
      hs.call('crateRemote', 'play', { id: t.id, ids }).then(() => toast(`▶ ON LAPTOP · ${t.title.toUpperCase()}`)).catch((er) => toast(er.message, true));
    } else { M.queue = M.view.slice(); playAt(i); }
  });
  function setOut(o) {
    M.out = o; store.set('phone-out', o);
    $$('#out button').forEach((b) => b.classList.toggle('on', b.dataset.v === o));
    if (o === 'laptop') audio.pause();
    renderPlayer(); renderList();
  }
  $('#out').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setOut(b.dataset.v); });

  // ----- SAVE TO FILES: real copies in the iPhone's Files app -----
  // The laptop packs the shown list into a .zip (one track: the file itself). The links go on a sheet to tap by hand,
  // since a browser only saves a download the user tapped. Tapping the .zip in Files unzips it into a folder.
  const where = 'Brave saves it to <b>Files → On My iPhone → Brave → Downloads</b>, Safari to <b>Files → Downloads</b>.';
  function saveSheet(html) { $('#save-body').innerHTML = html; $('#save-sheet').classList.remove('hidden'); }
  $('#save-x').addEventListener('click', () => $('#save-sheet').classList.add('hidden'));
  function saveOne(t) {
    if (!laptopUp) return toast('SAVING TO FILES NEEDS THE LAPTOP ON THIS WI-FI', true);
    saveSheet(`<a class="act" href="${esc(hs.media('track', t.id))}&dl=1" download>⇩ ${esc(t.artist ? `${t.artist} - ${t.title}` : t.title)}</a><p>${where}</p>`);
  }
  $('#save-files').addEventListener('click', async () => {
    const list = M.view;
    if (!list.length) return toast('NOTHING TO SAVE', true);
    if (list.length === 1) return saveOne(list[0]);
    if (!laptopUp) return toast('SAVING TO FILES NEEDS THE LAPTOP ON THIS WI-FI', true);
    const pl = M.playlists.find((p) => p.id === $('#pl').value);
    const name = [pl ? pl.name : 'HYPERSPACE', $('#q').value.trim()].filter(Boolean).join(' - ');
    saveSheet(`<p>packing ${list.length} tracks…</p>`);
    try {
      const r = await fetch('/media/zip', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HS-Key': hs.key() || '' }, body: JSON.stringify({ ids: list.map((t) => t.id), name }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (!j.parts.length) throw new Error("none of these files are on the laptop's disk");
      saveSheet(j.parts.map((p) => `<a class="act" href="${esc(p.url)}" download>⇩ ${esc(p.name)} · ${p.count} tracks · ${bytes(p.size)}</a>`).join('')
        + `<p>${where} Tap the .zip there and it opens into a folder of the real files.${j.parts.length > 1 ? ' It comes in parts because one .zip holds up to 4 GB: tap each.' : ''}${j.missing ? ` ${j.missing} track${j.missing === 1 ? " wasn't" : "s weren't"} found on the laptop.` : ''}</p>`);
    } catch (e) { saveSheet(`<p class="bad">couldn't pack them: ${esc(e.message)}</p>`); }
  });
  // hold a track: save just that one
  let holdT = null, held = false, hx = 0, hy = 0;
  $('#list').addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    held = false; hx = e.clientX; hy = e.clientY;
    clearTimeout(holdT);
    holdT = setTimeout(() => { const t = M.view[+row.dataset.i]; if (t) { held = true; saveOne(t); } }, 600);
  });
  $('#list').addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - hx) + Math.abs(e.clientY - hy) > 12) clearTimeout(holdT); });
  ['pointerup', 'pointercancel'].forEach((ev) => $('#list').addEventListener(ev, () => clearTimeout(holdT)));
  $('#list').addEventListener('contextmenu', (e) => { if (e.target.closest('.row')) e.preventDefault(); });

  // ----- on the phone: from what's saved here, else streamed from the laptop -----
  const audio = $('#audio');
  let blobUrl = null;
  const phoneTrack = () => M.queue[M.qi] || null;
  async function srcFor(t) {
    if (SECURE) {
      const r = await (await music()).match(trackKey(t.id));
      if (r) { if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(await r.blob()); return blobUrl; }
    }
    if (!laptopUp) return null;
    return hs.media('track', t.id);
  }
  async function playAt(i, tries = 0) {
    const t = M.queue[i];
    if (!t) return;
    const src = await srcFor(t);
    if (!src) { // not saved and the laptop is away: skip ahead to one that is
      if (tries < M.queue.length) return playAt(i + 1, tries + 1);
      return toast('NOTHING SAVED ON THIS PHONE YET', true);
    }
    M.qi = i;
    audio.src = src;
    audio.play().catch((e) => toast(`can't play: ${e.message}`, true));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: 'HYPERSPACE · CRATE', artwork: t.art ? [{ src: new URL(hs.media('art', t.id), location.href).href, sizes: '500x500', type: 'image/jpeg' }] : [] });
    }
    renderPlayer(); renderList();
  }
  audio.addEventListener('ended', () => { if (M.qi < M.queue.length - 1) playAt(M.qi + 1); });
  audio.addEventListener('play', renderPlayer);
  audio.addEventListener('pause', renderPlayer);
  audio.addEventListener('timeupdate', () => { if (M.out === 'phone') progress(audio.currentTime, audio.duration || phoneTrack()?.len); });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('nexttrack', () => playAt(M.qi + 1));
    ms.setActionHandler('previoustrack', () => (audio.currentTime > 4 ? (audio.currentTime = 0) : playAt(Math.max(0, M.qi - 1))));
    try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch {}
  }

  // ----- on the laptop -----
  hs.on('crate-now', (c) => { M.laptop = c; if (M.out === 'laptop') { renderPlayer(); renderList(); } });
  hs.call('crateNow').then((c) => { M.laptop = c; renderPlayer(); }).catch(() => {});

  // ----- the player bar -----
  const curId = () => (M.out === 'laptop' ? M.laptop?.id : phoneTrack()?.id);
  function progress(pos, len) { $('#p-prog i').style.width = len ? `${Math.min(100, (pos / len) * 100)}%` : '0'; }
  function renderPlayer() {
    const lap = M.out === 'laptop';
    const t = lap ? (laptopUp ? M.laptop : null) : phoneTrack();
    $('#player').classList.toggle('hidden', !t);
    if (!t) return;
    const full = M.byId.get(t.id) || t;
    $('#p-title').textContent = full.title || t.title || '';
    $('#p-sub').textContent = [lap ? '⌨ LAPTOP' : '▶ PHONE', full.artist, full.bpm ? `${Math.round(full.bpm)} BPM` : null].filter(Boolean).join(' · ');
    $('#p-art').style.backgroundImage = (full.art ?? t.art) ? `url('${hs.media('art', t.id)}')` : '';
    $('#p-play').textContent = (lap ? !!t.playing : !audio.paused) ? '❚❚' : '▶';
    if (lap) progress(t.pos, t.len);
  }
  const cmd = (a, arg) => hs.call('crateRemote', a, arg).catch((e) => toast(e.message, true));
  $('#p-play').addEventListener('click', () => (M.out === 'laptop' ? cmd('toggle') : audio.paused ? audio.play() : audio.pause()));
  $('#p-next').addEventListener('click', () => (M.out === 'laptop' ? cmd('next') : playAt(M.qi + 1)));
  $('#p-prev').addEventListener('click', () => (M.out === 'laptop' ? cmd('prev') : audio.currentTime > 4 ? (audio.currentTime = 0) : playAt(Math.max(0, M.qi - 1))));
  $('#p-prog').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    if (M.out === 'laptop') { if (M.laptop?.len) cmd('seek', f * M.laptop.len); }
    else if (audio.duration) audio.currentTime = f * audio.duration;
  });

  // ---------------- SYNC: every track and cover onto the phone ----------------
  const SY = { running: false, stop: false, done: 0, total: 0, bytes: 0, error: null, started: 0 };
  async function sync(manual = true) {
    if (!SECURE) return toast('SYNC NEEDS THE SECURE APP · SEE MOBILE MODE', true);
    if (SY.running) { if (manual) { SY.stop = true; toast('SYNC PAUSED'); } return; }
    if (!laptopUp) return manual && toast('SYNC NEEDS THE LAPTOP ON THIS WI-FI', true);
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
    await loadLib(true);
    const c = await music();
    M.saved = await savedIds();
    const want = new Set(M.tracks.map((t) => t.id));
    // tracks gone from the library leave the phone too
    for (const id of M.saved) if (!want.has(id)) { await c.delete(trackKey(id)); await c.delete(artKey(id)); M.saved.delete(id); }
    const todo = M.tracks.filter((t) => !M.saved.has(t.id));
    Object.assign(SY, { running: true, stop: false, done: 0, total: todo.length, bytes: 0, error: null, started: Date.now() });
    renderVitals();
    const one = async (t) => {
      const r = await fetch(hs.media('track', t.id));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      await c.put(trackKey(t.id), new Response(blob, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'audio/mpeg' } }));
      if (t.art) { const a = await fetch(hs.media('art', t.id)).catch(() => null); if (a?.ok) await c.put(artKey(t.id), a); }
      SY.bytes += blob.size; M.saved.add(t.id);
    };
    let i = 0;
    const worker = async () => {
      while (!SY.stop && i < todo.length) {
        const t = todo[i++];
        try { await one(t); } catch (e) {
          SY.error = /quota/i.test(e.name + e.message) ? 'the phone is out of space for HYPERSPACE' : e.message;
          if (/quota/i.test(e.name + e.message) || !laptopUp) { SY.stop = true; break; }
        }
        SY.done++;
        if (SY.done % 5 === 0 || SY.done === todo.length) { renderVitals(); if (tab === 'music') renderList(); }
      }
    };
    await Promise.all([worker(), worker()]);
    SY.running = false;
    renderVitals(); renderList();
    if (!SY.stop) toast(todo.length ? `SYNCED · ${M.saved.size} TRACKS ON THIS PHONE` : 'EVERYTHING IS ALREADY ON THIS PHONE');
    else if (SY.error) toast(`SYNC STOPPED: ${SY.error}`, true);
  }

  // ---------------- PHONE (this phone) ----------------
  let est = null;
  async function renderVitals() {
    if (mode !== 'phone' && tab !== 'phone') return;
    if (SECURE && navigator.storage?.estimate) { try { est = await navigator.storage.estimate(); } catch {} }
    const n = M.tracks.length || (await loadLib().then(() => M.tracks.length).catch(() => 0));
    const saved = M.saved.size, now = new Date();
    const pt = phoneTrack();
    const eta = SY.running && SY.done > 2 ? Math.round(((Date.now() - SY.started) / SY.done) * (SY.total - SY.done) / 60000) : null;
    $('#vitals').innerHTML = `
      <div class="tile wide"><div class="h">◷ ${now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</div><div class="big">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div></div>
      <div class="tile wide ${laptopUp ? 'vpn-on' : ''}"><div class="h">⌨ LAPTOP <em>${laptopUp && ping != null ? `${ping} ms` : ''}</em></div><div class="big">${laptopUp ? 'IN RANGE' : 'AWAY'}</div>
        <div class="sub">${laptopUp ? `${esc(location.host)} · controls on the LAPTOP tab` : 'offline music and the VJ keep working'}</div></div>
      <div class="tile wide"><div class="h">◎ ON THIS PHONE <em>${SECURE ? (store.get('auto-sync', true) ? 'AUTO-SYNC ON' : 'AUTO-SYNC OFF') : ''}</em></div>
        <div class="big">${SECURE ? `${saved} <small>/ ${n} tracks</small>` : '—'}</div>
        <div class="bar"><i style="width:${n ? (saved / n) * 100 : 0}%"></i></div>
        <div class="sub">${!SECURE ? 'needs the secure app (MOBILE MODE above)' : SY.running ? `syncing ${SY.done} / ${SY.total} · ${bytes(SY.bytes)}${eta != null ? ` · about ${eta} min left` : ''}` : SY.error ? `stopped: ${esc(SY.error)}` : saved >= n && n ? 'everything is here' : 'SYNC copies the rest over Wi-Fi'}</div>
        ${SECURE ? `<div class="btns"><button id="sync-go">${SY.running ? '❚❚ PAUSE' : '⇩ SYNC NOW'}</button><button id="sync-auto">${store.get('auto-sync', true) ? 'AUTO: ON' : 'AUTO: OFF'}</button></div>` : ''}</div>
      <div class="tile"><div class="h">⛁ STORAGE</div><div class="big">${est ? bytes(est.usage) : '—'}</div><div class="sub">${est?.quota ? `of ${bytes(est.quota)} allowed` : 'used by HYPERSPACE'}</div></div>
      <div class="tile"><div class="h">▶ PLAYING</div><div class="big small">${pt && !audio.paused ? '●' : '❚❚'}</div><div class="sub">${pt ? esc(pt.title) : 'nothing yet'}</div></div>
      <div class="tile wide"><div class="h">▣ THIS PHONE</div><div class="sub">${STANDALONE ? 'running as the home-screen app' : SHORTCUT ? 'running in Brave from the home screen' : 'running in the browser'} · ${screen.width}×${screen.height} · ${navigator.onLine ? 'online' : 'offline'}</div>
        <div class="sub">iPhone doesn't share battery or Wi-Fi details with web apps, so those can't be shown here.</div></div>`;
    $('#sync-go')?.addEventListener('click', () => sync(true));
    $('#sync-auto')?.addEventListener('click', () => { store.set('auto-sync', !store.get('auto-sync', true)); renderVitals(); });
  }
  setInterval(() => { if (tab === 'phone' && !SY.running) renderVitals(); }, 15000);

  // ---------------- MOBILE MODE setup ----------------
  // copy text, also on the plain http page where the clipboard API is switched off (falls back to the box's selection)
  async function copy(text, box) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try { // iPhones only select inside a box that is briefly editable
      box.readOnly = false; box.contentEditable = 'true'; box.focus(); box.setSelectionRange(0, text.length);
      return document.execCommand('copy');
    } catch { return false; } finally { box.contentEditable = 'false'; box.readOnly = true; box.blur(); }
  }
  // A guided setup, one thing per screen ("STEP 3 OF 10"), opened from a small card on the first tab.
  // Brave can't add web apps to the home screen, so its route makes the tile with Apple's Shortcuts app.
  let setupInfo = null;
  const ROUTES = {
    brave: ['browser', 'cert', 'install', 'trust', 'secure', 'copy', 'icon', 'shortcut', 'tile', 'done'],
    safari: ['cert', 'install', 'trust', 'secure', 'add', 'done'],
  };
  const afterSecure = (via) => ROUTES[via].indexOf('secure') + 1;
  const crumbs = (...p) => `<div class="crumbs">${p.map((x, i) => `<span${i === p.length - 1 ? ' class="end"' : ''}>${x}</span>`).join('<i>›</i>')}</div>`;
  const taps = (...t) => `<ol class="taps">${t.map((x) => `<li>${x}</li>`).join('')}</ol>`;
  function setupStep(id, via) {
    const k = encodeURIComponent(hs.key?.() || ''), info = setupInfo || {};
    const page = (host) => `https://${host}:${info.port}/renderer/phone.html?mode=phone&via=${via}&step=${afterSecure(via)}#k=${k}`;
    const n = (step) => ROUTES[via].indexOf(step) + 1;
    switch (id) {
      case 'browser': return { title: 'Make Brave your browser', body: `
        <p>The HYPERSPACE tile opens in your phone's main browser, so that has to be Brave.</p>
        <p>Leave Brave, open the grey <b>Settings</b> app and tap:</p>${crumbs('Apps', 'Default Apps', 'Browser App', 'Brave')}
        <p class="dim">Already Brave? Just tap NEXT.</p>` };
      case 'cert': return { title: 'Download the certificate', body: `
        <p>It lets this phone talk to your laptop securely. It only works on your own Wi-Fi, never for anything on the internet.</p>
        <a class="go" href="/setup/hyperspace-ca.cer">GET THE CERTIFICATE</a>
        <p>If the phone asks about a configuration profile, tap <b>Allow</b>, then <b>Close</b>. Then come back here and tap NEXT.</p>
        ${via === 'brave' ? `<details><summary>Nothing happened?</summary><p>Copy this link, paste it into Safari's address bar and tap <b>Allow</b>. Safari is only needed for this one step.</p>
          <input class="cp" id="cp-cert" readonly value="${esc(`${location.origin}/setup/hyperspace-ca.cer`)}"><button class="go ghost" data-copy="cp-cert">COPY THE LINK</button></details>` : ''}` };
      case 'install': return { title: 'Install the certificate', body: `
        <p>Open the <b>Settings</b> app. Right under your name at the top there's a new line, <b>Profile Downloaded</b>. Tap:</p>
        ${crumbs('Profile Downloaded', 'Install', 'your passcode', 'Install', 'Done')}
        <details><summary>No Profile Downloaded line?</summary><p>Open the <b>Files</b> app and tap:</p>${crumbs('Browse', 'On My iPhone', 'Brave', 'Downloads', 'HYPERSPACE.cer')}<p>Then look in Settings again.</p></details>` };
      case 'trust': return { title: 'Turn on trust', body: `
        <p>In the <b>Settings</b> app tap:</p>${crumbs('General', 'About', 'Certificate Trust Settings')}
        <p class="dim">Certificate Trust Settings is the very last line of About: scroll all the way down.</p>
        <p>Turn on the switch next to <b>HYPERSPACE Local CA</b>, then tap <b>Continue</b>.</p>` };
      case 'secure':
        if (SECURE) return { title: 'Secure HYPERSPACE: open', body: '<p>You\'re on it already. Tap NEXT.</p>' };
        // the button is filled in by reachSecure() once the phone has tried both addresses
        return { title: 'Open the secure HYPERSPACE', body: info.secure ? `
          <p>This opens HYPERSPACE at its secure address. This guide carries on there at step ${afterSecure(via) + 1}.</p>
          <div id="reach" data-name="${esc(page(info.host))}" data-ip="${esc(page(info.ips?.[0] || info.host))}" data-ipname="${esc(info.ips?.[0] || '')}" data-port="${info.port}" data-trust="${n('trust')}">
            <p class="dim">Checking that this phone can reach it…</p></div>`
          : '<p class="bad">The laptop isn\'t offering the secure address. Update HYPERSPACE on the laptop, then try again.</p>' };
      case 'copy': return SECURE ? { title: 'Copy the app link', body: `
        <p>This is the address your tile will open. Tap the button: it goes on your clipboard, like copying text.</p>
        <input class="cp" id="cp-app" readonly value="${esc(`${location.origin}/renderer/phone.html?mode=phone&app=brave#k=${k}`)}">
        <button class="go" data-copy="cp-app">COPY THE APP LINK</button>` }
        : { title: 'Copy the app link', body: `<p class="bad">This step needs the secure HYPERSPACE. Go back to step ${n('secure')}.</p>` };
      case 'icon': return { title: 'Save the tile picture', body: `
        <img class="wiz-icon" src="icons/icon-512.png" alt="">
        <p>This is how your tile will look. Tap the button to save the picture to your phone.</p>
        <a class="go" href="icons/icon-512.png" download="HYPERSPACE icon.png">SAVE THE PICTURE</a>
        <p>Brave keeps it in the <b>Files</b> app (On My iPhone › Brave › Downloads). You'll pick it in step ${n('tile')}.</p>
        <p class="dim">Optional: skip it and the tile gets a plain Shortcuts icon. If Brave just shows the picture instead, press on it until a menu appears and choose Save to Photos.</p>` };
      case 'shortcut': return { title: 'Make the shortcut', body: `
        <p>Apple's <b>Shortcuts</b> app is already on your phone. It will open a blank new shortcut.</p>
        <a class="go" href="shortcuts://create-shortcut">OPEN SHORTCUTS</a>
        ${taps('If Shortcuts opens on a list instead, tap <b>+</b> at the top right.', 'Tap the <b>Search Actions</b> bar at the bottom and type <b>Open URLs</b>.', 'Tap <b>Open URLs</b> in the results. A block appears that says <b>Open URL</b>.', 'Tap the faded word <b>URL</b> in that block, then tap <b>Paste</b>.')}
        <p class="dim">No Paste? Come back here, go back to step ${n('copy')} and copy the link again. Then come back here and tap NEXT.</p>` };
      case 'tile': return { title: 'Put it on your home screen', body: `
        <p>Still in Shortcuts:</p>
        ${taps('Tap the name at the very top of the shortcut (it says <b>Open URLs</b>).', 'Tap <b>Rename</b>, type <b>HYPERSPACE</b>, tap <b>Done</b>.', 'Tap the name again, then <b>Add to Home Screen</b>.', 'Tap the small icon on the left, then <b>Choose File</b> › On My iPhone › Brave › Downloads › <b>HYPERSPACE icon</b>. (Saved it to Photos? Choose Photo.)', 'Tap <b>Add</b> at the top right.')}` };
      case 'add': return { title: 'Add it to your home screen', body: `
        <p>Right here in Safari:</p>
        ${taps('Tap <b>⋯</b> at the bottom right, next to the address bar.', 'Tap <b>Share</b>.', 'Tap <b>Add to Home Screen</b>. Not in the list? Tap <b>View More</b> first.', 'Leave <b>Open as Web App</b> on and tap <b>Add</b>.')}
        <p class="dim">Older iPhones: the Share button is the square with an arrow on the bottom bar.</p>` };
      default: return { title: 'Open it from the tile', body: `
        <p>Go to your home screen and tap the new <b>HYPERSPACE</b> tile. It opens on the PHONE tab and this guide goes away.</p>
        <p>Then tap <b>⇩ SYNC NOW</b> to copy your music to the phone. Keep the screen on until it finishes.</p>
        ${via === 'brave' ? '<p class="dim">If the tile opens Safari, Brave isn\'t your main browser yet: see step 1.</p>' : ''}` };
    }
  }
  // step 5: try the secure door by name and by number, then offer the one that answers. Both failing almost
  // always means the phone doesn't trust the certificate yet; only the name failing means the Wi-Fi doesn't
  // pass the laptop's name along (then the number works, as long as the laptop keeps that address)
  async function reachSecure(el) {
    const d = el.dataset;
    el.innerHTML = '<p class="dim">Checking that this phone can reach it…</p>';
    const ok = async (host) => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 5000);
      try { return (await fetch(`https://${host}:${d.port}/setup/info`, { signal: c.signal, cache: 'no-store' })).ok; } catch { return false; } finally { clearTimeout(t); }
    };
    const [byName, byIp] = await Promise.all([ok('hyperspace.local'), d.ipname ? ok(d.ipname) : false]);
    const retry = '<button class="go ghost" data-recheck>CHECK AGAIN</button>';
    el.innerHTML = byName
      ? `<p class="okay">✓ This phone can reach it.</p><a class="go" href="${esc(d.name)}">OPEN THE SECURE HYPERSPACE</a>`
      : byIp
        ? `<p class="okay">✓ This phone can reach it by the laptop's number address.</p><a class="go" href="${esc(d.ip)}">OPEN THE SECURE HYPERSPACE</a>
           <p class="dim">Your Wi-Fi doesn't pass the laptop's name (hyperspace.local) along, so this uses ${esc(d.ipname)}. If the laptop gets a different address one day, run this setup again.</p>`
        : `<p class="bad">✗ This phone can't open the secure address yet.</p>
           <p>Almost always the trust switch is still off. In <b>Settings</b> tap:</p>${crumbs('General', 'About', 'Certificate Trust Settings')}
           <p>Turn on <b>HYPERSPACE Local CA</b>, tap <b>Continue</b>, then come back and tap CHECK AGAIN.</p>
           <p class="dim">No HYPERSPACE Local CA in that list? The certificate isn't installed: go back to step 2.</p>${retry}
           <details><summary>Try opening it anyway</summary><a class="go ghost" href="${esc(d.name)}">BY NAME</a><a class="go ghost" href="${esc(d.ip)}">BY NUMBER ADDRESS</a></details>`;
  }
  function wizard(open = true) {
    const w = $('#wiz');
    if (!open) { w.classList.add('hidden'); renderSetup(); return; }
    w.classList.remove('hidden');
    const via = store.get('setup-browser', null);
    if (!ROUTES[via]) {
      w.innerHTML = `<div class="wiz-top"><span>MOBILE MODE SETUP</span><button class="x" data-w="close">✕</button></div>
        <div class="wiz-body"><div class="wiz-n">BEFORE YOU START</div><h2>Which browser do you use on this phone?</h2>
          <div class="choice"><button data-w="pick" data-v="brave"><span class="ic">🦁</span><span><b>BRAVE</b><span class="sub2">The tile is made with Apple's Shortcuts app. 10 short steps.</span></span></button>
          <button data-w="pick" data-v="safari"><span class="ic">🧭</span><span><b>SAFARI</b><span class="sub2">Safari adds the tile itself. 6 short steps.</span></span></button></div>
          <p class="dim" style="margin-top:16px">Keep the laptop on, with HYPERSPACE open, and the phone on the same Wi-Fi.</p></div>`;
    } else {
      const steps = ROUTES[via], i = Math.min(store.get('setup-step', 0), steps.length - 1), s = setupStep(steps[i], via);
      w.innerHTML = `<div class="wiz-top"><span>MOBILE MODE SETUP · ${via.toUpperCase()}</span><button class="x" data-w="close">✕</button></div>
        <div class="wiz-bar">${steps.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'cur' : ''}"></i>`).join('')}</div>
        <div class="wiz-body"><div class="wiz-n">STEP ${i + 1} OF ${steps.length}</div><h2>${s.title}</h2>${s.body}</div>
        <div class="wiz-nav"><button data-w="back">‹ BACK</button><button class="next" data-w="next">${i === steps.length - 1 ? 'FINISH' : 'NEXT ›'}</button></div>`;
    }
    if ($('#reach')) reachSecure($('#reach'));
    w.onclick = async (e) => {
      if (e.target.closest('[data-recheck]')) return reachSecure($('#reach'));
      const b = e.target.closest('[data-w], [data-copy]');
      if (!b) return;
      if (b.dataset.copy) { const box = $(`#${b.dataset.copy}`); b.textContent = (await copy(box.value, box)) ? '✓ COPIED' : 'PRESS ON THE LINK ABOVE TO COPY IT'; return; }
      const v = store.get('setup-browser', null), i = store.get('setup-step', 0);
      switch (b.dataset.w) {
        case 'close': return wizard(false);
        case 'pick': store.set('setup-browser', b.dataset.v); store.set('setup-step', SECURE ? afterSecure(b.dataset.v) : 0); break;
        case 'back': if (i > 0) store.set('setup-step', i - 1); else store.set('setup-browser', null); break;
        case 'next': if (i >= ROUTES[v].length - 1) { store.set('setup-hidden', true); return wizard(false); } store.set('setup-step', i + 1); break;
      }
      wizard();
    };
  }
  // the small card on the first tab: where you are, and the way in
  async function renderSetup() {
    const el = $('#setup');
    if ((SECURE && INSTALLED) || store.get('setup-hidden', false)) { el.classList.add('hidden'); return; }
    if (!setupInfo) { try { setupInfo = await (await fetch('/setup/info')).json(); } catch { setupInfo = {}; } }
    const via = store.get('setup-browser', null), steps = ROUTES[via];
    const i = steps ? Math.min(store.get('setup-step', 0), steps.length - 1) : 0;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="h">▣ MOBILE MODE <em>works with the laptop off</em> <button class="x" id="setup-x">✕</button></div>
      ${steps ? `<div class="wiz-bar">${steps.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'cur' : ''}"></i>`).join('')}</div>
        <p>Step ${i + 1} of ${steps.length}: <b>${setupStep(steps[i], via).title}</b></p>`
        : '<p>Put HYPERSPACE on your home screen, with your music saved on the phone. One time, about 5 minutes.</p>'}
      <button class="go" id="setup-go">${steps && i ? 'CONTINUE SETUP ›' : 'START SETUP ›'}</button>`;
    $('#setup-go').addEventListener('click', () => wizard());
    $('#setup-x').addEventListener('click', () => { store.set('setup-hidden', true); el.classList.add('hidden'); });
  }
  // ---------------- encrypted only ----------------
  // On the plain address nothing private is sent, so instead of the app this shows the way to the encrypted one
  async function lockGate() {
    if (!hs.plain) return;
    if (!setupInfo) { try { setupInfo = await (await fetch('/setup/info')).json(); } catch { setupInfo = {}; } }
    const k = encodeURIComponent(hs.key?.() || ''), i = setupInfo;
    const at = (host) => `https://${host}:${i.port}/renderer/phone.html?mode=phone#k=${k}`;
    const g = document.createElement('div');
    g.className = 'wiz lock';
    g.innerHTML = `<div class="wiz-top"><span>🔒 ENCRYPTED ONLY</span></div>
      <div class="wiz-body"><div class="wiz-n">PHONE LINK</div><h2>HYPERSPACE only talks over an encrypted connection</h2>
        <p>This address isn't encrypted, so nothing of yours goes over it: no pairing key, no music, no controls.</p>
        ${i.secure ? `<div id="lock-reach" data-name="${esc(at(i.host))}" data-ip="${esc(at(i.ips?.[0] || i.host))}" data-ipname="${esc(i.ips?.[0] || '')}" data-port="${i.port}"></div>`
          : '<p class="bad">The laptop isn\'t offering its encrypted address. Update HYPERSPACE on the laptop.</p>'}
        <p class="dim" style="margin-top:18px">First time on this phone? The one-time setup gets it ready, about 5 minutes.</p>
        <button class="go ghost" id="lock-setup">SET UP THIS PHONE</button></div>`;
    document.body.appendChild(g);
    $('#lock-setup').addEventListener('click', () => wizard());
    const r = $('#lock-reach');
    if (r) { reachSecure(r); g.addEventListener('click', (e) => { if (e.target.closest('[data-recheck]')) reachSecure(r); }); }
  }
  lockGate();
  // arriving at the secure address from the guide (?step=): carry on where it left off
  if (QS.get('step') && !INSTALLED) { store.set('setup-step', +QS.get('step')); setTimeout(() => wizard(), 400); }
  else if (SECURE && !INSTALLED && ROUTES[store.get('setup-browser', null)] && store.get('setup-step', 0) < afterSecure(store.get('setup-browser', null))) store.set('setup-step', afterSecure(store.get('setup-browser', null)));

  // ---------------- VJ ----------------
  PhoneVJ.mount($('#vj'), () => (phoneTrack() && !audio.paused ? { bpm: phoneTrack().bpm, pos: audio.currentTime, playing: true } : null));
  $('#vj-next').addEventListener('click', () => { $('#vj-name').textContent = PhoneVJ.next(1); });
  $('#vj-prev').addEventListener('click', () => { $('#vj-name').textContent = PhoneVJ.next(-1); });
  $('#vj-pal').addEventListener('click', () => { PhoneVJ.palette(); $('#vj-name').textContent = PhoneVJ.name(); });
  $('#vj').addEventListener('pointerup', () => setTimeout(() => { $('#vj-name').textContent = PhoneVJ.name(); }, 0));
  $('#vj-mic').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { const on = await PhoneVJ.mic(!b.classList.contains('on')); b.classList.toggle('on', on); toast(on ? 'VJ LISTENS TO THE MIC' : 'VJ FOLLOWS THE MUSIC'); }
    catch { toast(SECURE ? 'MIC NOT ALLOWED' : 'THE MIC NEEDS THE SECURE APP (MOBILE MODE)', true); }
  });

  // ---------------- CONTROL (the laptop) ----------------
  let vol = null, hw = null, cfg = null;
  async function refreshControl() {
    if (!laptopUp && D.perf == null) return;
    try { vol = await core('audio.getVolume'); } catch {}
    try { hw = await hs.call('hwState'); } catch {}
    try { cfg = await hs.call('config'); } catch {}
    window.applyAccent(cfg?.look);
    try { const m = await core('media.get'); $('#wm').innerHTML = m?.available ? `<b>${esc(m.title || '—')}</b><span>${esc(m.artist || '')}</span>` : '<span>nothing playing</span>'; } catch {}
    renderControl();
  }
  function renderControl() {
    if (vol) { if (document.activeElement !== $('#vol')) $('#vol').value = Math.round(vol.level * 100); $('#vol-v').textContent = vol.muted ? 'MUTED' : pct(vol.level * 100); $('#vol-mute').classList.toggle('on', !!vol.muted); }
    if (hw) $$('[data-hw]').forEach((b) => { const on = hw[b.dataset.hw].on; b.classList.toggle('on', on); b.classList.toggle('off', !on); b.textContent = `${b.dataset.hw.toUpperCase()} ${on ? 'OPEN' : 'SEALED'}`; });
    if (cfg) {
      $$('[data-preset]').forEach((b) => b.classList.toggle('on', cfg.preset === b.dataset.preset));
      $$('[data-fan]').forEach((b) => b.classList.toggle('on', (D.tele?.fans?.mode || cfg.fans?.mode) === b.dataset.fan));
    }
  }
  let vT;
  $('#vol').addEventListener('input', (e) => { clearTimeout(vT); vT = setTimeout(async () => { try { vol = await core('audio.volume', { level: e.target.value / 100 }); renderControl(); } catch {} }, 80); });
  $('#vol-mute').addEventListener('click', async () => { try { vol = await core('audio.volume', { muted: !vol?.muted }); renderControl(); } catch (e) { toast(e.message, true); } });
  $$('[data-wm]').forEach((b) => b.addEventListener('click', async () => { try { const m = await core('media.cmd', { action: b.dataset.wm }); $('#wm').innerHTML = m?.available ? `<b>${esc(m.title || '—')}</b><span>${esc(m.artist || '')}</span>` : '<span>nothing playing</span>'; } catch (e) { toast(e.message, true); } }));
  $$('[data-hw]').forEach((b) => b.addEventListener('click', async () => {
    if (!hw) return;
    const k = b.dataset.hw;
    try { hw = await hs.call(k === 'mic' ? 'setMic' : 'setCam', !hw[k].on); renderControl(); toast(`${k.toUpperCase()} ${hw[k].on ? 'OPEN' : 'SEALED'}`, !hw[k].on); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-preset]').forEach((b) => b.addEventListener('click', async () => {
    try { await core('preset.apply', { name: b.dataset.preset }); await hs.call('setConfig', { preset: b.dataset.preset }); cfg = { ...cfg, preset: b.dataset.preset }; renderControl(); toast(`${b.dataset.preset.toUpperCase()} MODE`); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-fan]').forEach((b) => b.addEventListener('click', async () => {
    const f = { ...(cfg?.fans || {}), mode: b.dataset.fan };
    try { await core('fans.set', { mode: f.mode, cpu: f.cpu, gpu: f.gpu }); await hs.call('setConfig', { fans: f }); cfg = { ...cfg, fans: f }; renderControl(); toast(`FANS: ${f.mode.toUpperCase()}`); } catch (e) { toast(e.message, true); }
  }));
  hs.on('config', (c) => { cfg = c; window.applyAccent(c?.look); renderControl(); });

  // ---------------- matrix rain + faint flower of life (30 fps cap, paused when hidden, off for low power / reduced motion) ----------------
  const cv = $('#rain'), ctx = cv.getContext('2d');
  let drops = [], lowBatt = false, lastT = 0, raf = 0, tick7 = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const saver = () => reduce.matches || lowBatt || (navigator.connection && navigator.connection.saveData);
  const flower = () => { // faint petals, redrawn now and then so the rain's fade doesn't erase them
    const cx = cv.width / 2, cy = cv.height * 0.45, r = Math.min(cv.width, cv.height) * 0.16;
    ctx.save(); ctx.strokeStyle = 'rgba(0,255,110,0.10)'; ctx.lineWidth = 1;
    const c = (x, y) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); };
    c(cx, cy); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.restore();
  };
  function size() { cv.width = innerWidth; cv.height = innerHeight; drops = Array.from({ length: Math.ceil(innerWidth / 16) }, () => Math.random() * innerHeight / 16); ctx.fillStyle = '#000400'; ctx.fillRect(0, 0, cv.width, cv.height); flower(); }
  size(); addEventListener('resize', size);
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastT < 33) return; lastT = t; // about 30 fps
    ctx.fillStyle = 'rgba(0,4,0,0.16)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#00ff6e'; ctx.font = '14px monospace';
    if (++tick7 % 8 === 0) flower();
    for (let i = 0; i < drops.length; i++) { const y = drops[i]; ctx.fillText(String.fromCharCode(0x30a0 + Math.random() * 96), i * 16, y * 16); drops[i] = y * 16 > cv.height && Math.random() > 0.97 ? 0 : y + 0.5; }
  }
  function rainSync() {
    const go = !document.hidden && tab !== 'vj' && !saver();
    if (go && !raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    if (!go && raf) { cancelAnimationFrame(raf); raf = 0; }
    cv.style.opacity = saver() ? '0.25' : '';
  }
  document.addEventListener('visibilitychange', rainSync);
  if (reduce.addEventListener) reduce.addEventListener('change', rainSync);
  if (navigator.getBattery) navigator.getBattery().then((b) => { const f = () => { lowBatt = !b.charging && b.level < 0.2; rainSync(); }; b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f); f(); }).catch(() => {});
  $('#tabs').addEventListener('click', () => setTimeout(rainSync, 0)); // the rain rests while the VJ owns the screen
  $('#mode').addEventListener('click', () => setTimeout(rainSync, 0));

  // ---------------- haptics: a tiny tick on button taps, where the phone supports it ----------------
  document.addEventListener('click', (e) => { if (navigator.vibrate && e.target.closest('button, .row, a.go')) navigator.vibrate(8); }, true);

  // ---------------- twr: a pixel rabbit, hidden until the title is tapped 7 times ----------------
  (() => {
    const KEY = 'hs-twr-phone';
    const SPR = ['..#..#....', '..#..#....', '..#..#....', '..####....', '.######...', '.#.##.#...', '.######...', '.##..##...', '..####....', '.######.#.', '########..', '########..', '.######...', '..#..#....'];
    const peek = document.createElement('button'); peek.id = 'twr-peek'; peek.setAttribute('aria-label', 'rabbit'); peek.className = 'hidden';
    const c = document.createElement('canvas'); c.width = 10; c.height = 14; peek.appendChild(c);
    const g = c.getContext('2d'); g.fillStyle = '#9dffb8'; SPR.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') g.fillRect(x, y, 1, 1); }));
    g.fillStyle = '#000400'; g.fillRect(3, 5, 1, 1); g.fillRect(6, 5, 1, 1);
    const say = document.createElement('div'); say.id = 'twr-say';
    document.body.append(peek, say);
    const JOKES = ['Why did the rabbit use Wi-Fi? To hop online.', 'There is no spoon. Only carrots.', 'I would tell a UDP joke, but you might not get it.', 'Follow the white rabbit. Mind the cables.', 'A bit and a byte walk into a bar. The bit says: I am parity.'];
    let ji = Math.floor(Math.random() * JOKES.length), st;
    const on = () => store.get(KEY, false) === true;
    const sync = () => { peek.classList.toggle('hidden', !on()); requestAnimationFrame(() => peek.classList.toggle('up', on())); };
    peek.addEventListener('click', () => { say.textContent = JOKES[ji++ % JOKES.length]; say.classList.add('show'); clearTimeout(st); st = setTimeout(() => say.classList.remove('show'), 4200); });
    let taps = 0, tt;
    $('.top b').addEventListener('click', () => {
      clearTimeout(tt); tt = setTimeout(() => { taps = 0; }, 1500);
      if (++taps >= 7) { taps = 0; store.set(KEY, !on()); sync(); toast(on() ? 'THE WHITE RABBIT IS HERE' : 'THE RABBIT HOPPED AWAY'); }
    });
    sync();
  })();

  // ---------------- start ----------------
  setOut(M.out);
  setMode(mode);
  hs.call('vpnStatus').then((v) => { D.vpn = v; renderHome(); }).catch(() => {});
  tick();
})();
