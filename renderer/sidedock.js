// SIDE DOCK window. Every module is { title, mount(el), update(el, data) }: add one to MODS and it shows up in
// Settings → SIDE DOCK to switch on and order. Data comes from the same feeds the main window uses
// (perf every 2 s, telemetry events from HyperCore, VPN events, media / mic / cam polled).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v) => (v == null || isNaN(v) ? '--' : `${Math.round(v)}%`);
  const bytes = (b) => { if (b == null || isNaN(b)) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`; };
  const rate = (b) => `${bytes(b)}/s`;
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`; };
  const core = (cmd, args) => hs.call('core', cmd, args);
  const D = { perf: null, tele: null, vpn: null, media: null, hw: null, procs: null, vol: null, crate: null, thermal: [] };
  const len = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const heat = (el, v, lim) => { el.classList.toggle('hot', v != null && v >= lim); el.classList.toggle('warm', v != null && v >= lim - 8 && v < lim); };

  const MODS = {
    clock: {
      title: 'CLOCK',
      mount(el) { el.innerHTML = '<div class="m-h">◷ TIME</div><div class="m-big"></div><div class="m-sub"></div>'; },
      update(el) { const d = new Date(); $('.m-big', el).textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); $('.m-sub', el).textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase(); },
    },
    vpn: {
      title: 'VPN',
      mount(el) {
        el.innerHTML = '<div class="m-h">⛨ VPN <em class="v-since"></em></div><div class="m-big"><i class="dot"></i><span class="v-state"></span></div><div class="m-sub v-sub"></div><div class="m-btns"><button class="v-tog">TURN ON</button><button class="v-open" title="Opens your VPN app">VPN APP</button></div><div class="m-sub v-msg"></div>';
        $('.v-open', el).addEventListener('click', () => hs.call('vpnOpen', D.vpn?.provider || D.vpn?.apps?.[0] || null));
        // TURN ON / TURN OFF: presses Connect / Disconnect in the Proton VPN app for you
        const tog = $('.v-tog', el), msg = $('.v-msg', el);
        const why = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
        tog.addEventListener('click', async () => {
          const on = !D.vpn?.on;
          D.vpnBusy = on ? 'TURNING ON…' : 'TURNING OFF…'; msg.textContent = ''; render();
          try {
            await hs.call('vpnToggle', on);
            // the status line catches up a few seconds later: keep saying TURNING… until it has
            for (let i = 0; i < 40 && !!D.vpn?.on !== on; i++) await new Promise((r) => setTimeout(r, 250));
          } catch (e) { msg.textContent = why(e); }
          D.vpnBusy = null; render();
        });
      },
      update(el) {
        const v = D.vpn;
        el.classList.add('m-vpn');
        el.classList.toggle('on', !!v?.on); el.classList.toggle('off', !!v && !v.on);
        $('.v-state', el).textContent = !v ? 'checking…' : v.on ? `${v.provider || 'VPN'} ON` : 'NOT PROTECTED';
        $('.v-sub', el).textContent = !v ? '' : v.on ? `${v.adapter} · tunnel ${v.ip}` : v.apps?.length ? `${v.apps.join(', ')} open, not connected` : 'no VPN connected';
        $('.v-since', el).textContent = v?.on && v.since ? ago(v.since) : '';
        const tog = $('.v-tog', el);
        tog.textContent = D.vpnBusy || (v?.on ? 'TURN OFF' : 'TURN ON');
        tog.disabled = !!D.vpnBusy;
        tog.classList.toggle('on', !!v?.on);
      },
    },
    temps: {
      title: 'TEMPS',
      mount(el) { el.innerHTML = '<div class="m-h">☢ TEMPS</div><div class="m-pair"><div><span>CPU</span><b class="tc">--</b></div><div><span>GPU</span><b class="tg">--</b></div></div>'; },
      update(el) {
        const t = D.tele, c = t?.cpu?.temp, g = t?.gpuTemp ?? t?.gpu?.temp, a = t?.alarm;
        $('.tc', el).textContent = c != null ? `${c}°` : '--'; heat($('.tc', el), c, a?.cpuLimit ?? 95);
        $('.tg', el).textContent = g != null ? `${g}°` : '--'; heat($('.tg', el), g, a?.gpuLimit ?? 87);
      },
    },
    cpu: {
      title: 'CPU',
      mount(el) { el.innerHTML = '<div class="m-h">✺ CPU <em></em></div><div class="m-big"></div><div class="m-bar"><i></i></div>'; },
      update(el) {
        const p = D.perf, t = D.tele;
        if (!p) return;
        $('.m-big', el).textContent = pct(p.cpu); $('.m-bar i', el).style.width = `${p.cpu || 0}%`;
        $('em', el).textContent = [t?.cpu?.clock ? `${(t.cpu.clock / 1000).toFixed(1)} GHz` : null, t?.cpu?.power ? `${t.cpu.power.toFixed(0)} W` : null].filter(Boolean).join(' · ');
      },
    },
    gpu: {
      title: 'GPU',
      mount(el) { el.innerHTML = '<div class="m-h">◈ GPU <em></em></div><div class="m-big"></div><div class="m-bar"><i></i></div>'; },
      update(el) {
        const g = D.tele?.gpu, u = g?.util ?? D.perf?.gpu;
        $('.m-big', el).textContent = pct(u); $('.m-bar i', el).style.width = `${u || 0}%`;
        $('em', el).textContent = g ? `VRAM ${bytes(g.memUsed)}` : '';
      },
    },
    ram: {
      title: 'MEMORY',
      mount(el) { el.innerHTML = '<div class="m-h">▤ MEMORY <em></em></div><div class="m-big"></div><div class="m-bar"><i></i></div>'; },
      update(el) {
        const m = D.perf?.mem;
        if (!m) return;
        const v = (m.used / m.total) * 100;
        $('.m-big', el).textContent = pct(v); $('.m-bar i', el).style.width = `${v}%`; $('em', el).textContent = `${bytes(m.used)} / ${bytes(m.total)}`;
      },
    },
    fans: {
      title: 'FANS',
      mount(el) { el.innerHTML = '<div class="m-h">❋ FANS <em></em></div><div class="m-pair"><div><span>CPU RPM</span><b class="fc">--</b></div><div><span>GPU RPM</span><b class="fg">--</b></div></div>'; },
      update(el) { const t = D.tele; $('.fc', el).textContent = t?.cpu?.fanRpm ?? '--'; $('.fg', el).textContent = t?.gpuFanRpm ?? '--'; $('em', el).textContent = (t?.fans?.mode || '').toUpperCase(); },
    },
    net: {
      title: 'NETWORK',
      mount(el) { el.innerHTML = '<div class="m-h">⇅ NETWORK</div><div class="m-pair"><div><span>↓ IN</span><b class="rx">--</b></div><div><span>↑ OUT</span><b class="tx">--</b></div></div>'; },
      update(el) { const n = D.perf?.net; if (!n) return; $('.rx', el).textContent = rate(n.rx); $('.tx', el).textContent = rate(n.tx); },
    },
    disk: {
      title: 'DISK',
      mount(el) { el.innerHTML = '<div class="m-h">⛁ DISK <em></em></div><div class="m-pair"><div><span>READ</span><b class="rd">--</b></div><div><span>WRITE</span><b class="wr">--</b></div></div>'; },
      update(el) { const d = D.perf?.disk; if (!d) return; $('.rd', el).textContent = rate(d.read); $('.wr', el).textContent = rate(d.write); $('em', el).textContent = pct(d.pct); },
    },
    media: {
      title: 'NOW PLAYING',
      mount(el) {
        el.innerHTML = '<div class="m-h">▶ NOW PLAYING</div><div class="m-track"></div><div class="m-btns"><button data-m="prev">⏮</button><button data-m="toggle">⏯</button><button data-m="next">⏭</button></div>';
        el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => core('media.cmd', { action: b.dataset.m }).then((m) => { D.media = m; render(); }).catch(() => {})));
      },
      update(el) { const m = D.media; $('.m-track', el).innerHTML = m?.available ? `<b>${esc(m.title || '—')}</b><span>${esc(m.artist || '')}</span>` : '<span>nothing playing</span>'; },
    },
    shield: {
      title: 'MIC / CAM',
      mount(el) {
        el.innerHTML = '<div class="m-h">⟁ SHIELD</div><div class="m-btns"><button data-k="mic">MIC</button><button data-k="cam">CAM</button></div>';
        el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async () => {
          if (!D.hw) return;
          const k = b.dataset.k, next = !D.hw[k].on;
          try { D.hw = await hs.call(k === 'mic' ? 'setMic' : 'setCam', next); render(); } catch {}
        }));
      },
      update(el) {
        const h = D.hw;
        if (!h) return;
        el.querySelectorAll('[data-k]').forEach((b) => { const on = h[b.dataset.k].on; b.classList.toggle('on', on); b.classList.toggle('off', !on); b.textContent = `${b.dataset.k.toUpperCase()} ${on ? 'OPEN' : 'SEALED'}`; });
      },
    },
    thermals: {
      title: 'TEMP HISTORY',
      mount(el) { el.innerHTML = '<div class="m-h">♨ TEMPS · 30 MIN <em></em></div><canvas class="spark"></canvas>'; },
      update(el) {
        const rows = D.thermal, c = $('canvas', el), r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
        if (!r.width) return;
        c.width = r.width * dpr; c.height = r.height * dpr;
        const ctx = c.getContext('2d'), w = c.width, h = c.height, t0 = Date.now() - 1800e3, last = rows[rows.length - 1];
        $('em', el).textContent = last ? `CPU ${last[1] ?? '--'}° · GPU ${last[2] ?? '--'}°` : '';
        for (const [i, col] of [[2, '#1de9b6'], [1, '#00ff6e']]) {
          ctx.beginPath(); let on = false;
          for (const x of rows) {
            if (x[i] == null || x[0] < t0) { on = false; continue; }
            const px = ((x[0] - t0) / 1800e3) * w, py = h - ((x[i] - 30) / 70) * (h - 4) - 2;
            on ? ctx.lineTo(px, py) : ctx.moveTo(px, py); on = true;
          }
          ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        }
      },
    },
    drives: {
      title: 'DRIVES',
      mount(el) { el.innerHTML = '<div class="m-h">⛃ DRIVES</div><div class="m-list"></div>'; },
      update(el) {
        const d = D.perf?.drives;
        if (!d) return;
        $('.m-list', el).innerHTML = d.filter((x) => x.size > 0).map((x) => { const p = (x.used / x.size) * 100; return `<div><span>${esc(x.mount)}</span><b class="${p > 92 ? 'hot' : p > 82 ? 'warm' : ''}">${bytes(x.size - x.used)} free</b></div><div class="m-bar"><i style="width:${p}%"></i></div>`; }).join('');
      },
    },
    apps: {
      title: 'TOP APPS',
      mount(el) { el.innerHTML = '<div class="m-h">⚙ TOP APPS <em>CPU</em></div><div class="m-list"></div>'; },
      update(el) {
        const list = D.procs?.list;
        if (!list) return;
        const by = new Map();
        for (const p of list) { const k = p.name.replace(/\.exe$/i, ''); const e = by.get(k) || { cpu: 0, mem: 0 }; e.cpu += p.cpu || 0; e.mem += p.mem || 0; by.set(k, e); }
        $('.m-list', el).innerHTML = [...by.entries()].sort((a, b) => b[1].cpu - a[1].cpu).slice(0, 5).map(([n, e]) => `<div><span>${esc(n)}</span><b>${e.cpu.toFixed(0)}% · ${bytes(e.mem)}</b></div>`).join('');
      },
    },
    crate: {
      title: 'CRATE PLAYER',
      mount(el) {
        el.innerHTML = '<div class="m-h">◎ CRATE <em></em></div><div class="m-row"><i class="m-art"></i><div class="m-track"></div></div><div class="m-bar"><i></i></div><div class="m-btns"><button data-c="prev">⏮</button><button data-c="toggle">⏯</button><button data-c="next">⏭</button></div>';
        el.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => hs.call('dockCmd', 'crate', b.dataset.c)));
      },
      update(el) {
        const c = D.crate;
        $('.m-track', el).innerHTML = c ? `<b>${esc(c.title)}</b><span>${esc(c.artist || '')}</span>` : '<span>nothing loaded in CRATE</span>';
        $('em', el).textContent = c ? `${c.bpm ? Math.round(c.bpm) + ' BPM' : ''} ${c.key || ''}`.trim() : '';
        $('.m-art', el).style.backgroundImage = c?.art ? `url('hsmedia://art/${encodeURIComponent(c.id)}')` : '';
        $('.m-bar i', el).style.width = c?.len ? `${(c.pos / c.len) * 100}%` : '0';
        $('[data-c="toggle"]', el).textContent = c?.playing ? '❚❚' : '▶';
      },
    },
    volume: {
      title: 'VOLUME',
      mount(el) {
        el.innerHTML = '<div class="m-h">♫ VOLUME <em></em></div><input type="range" class="m-range" min="0" max="100" /><div class="m-btns"><button class="v-mute">MUTE</button></div>';
        let t = null;
        $('input', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => core('audio.volume', { level: e.target.value / 100 }).then((v) => { D.vol = v; }).catch(() => {}), 60); });
        $('.v-mute', el).addEventListener('click', () => core('audio.volume', { muted: !D.vol?.muted }).then((v) => { D.vol = v; render(); }).catch(() => {}));
      },
      update(el) {
        const v = D.vol;
        if (!v) return;
        $('em', el).textContent = v.muted ? 'MUTED' : pct(v.level * 100);
        if (document.activeElement !== $('input', el)) $('input', el).value = Math.round(v.level * 100);
        $('.v-mute', el).classList.toggle('on', !!v.muted);
      },
    },
    battery: {
      title: 'BATTERY',
      mount(el) { el.innerHTML = '<div class="m-h">⌁ BATTERY <em></em></div><div class="m-big"></div><div class="m-bar"><i></i></div>'; },
      update(el) {
        const b = D.perf?.battery;
        $('.m-big', el).textContent = b ? pct(b.pct) : 'no battery';
        $('.m-bar i', el).style.width = `${b?.pct || 0}%`;
        $('em', el).textContent = b ? (b.charging ? '⚡ CHARGING' : 'ON BATTERY') : '';
        $('.m-big', el).classList.toggle('hot', !!b && !b.charging && b.pct <= 15);
      },
    },
    notes: {
      // QUICK NOTE, three modes (the button cycles them, the choice is remembered):
      //   LAST     edits the note you changed most recently, right here, in place
      //   POPULAR  edits the note you've opened / saved the most in the last 36 hours
      //   NEW      an empty box: saves into the page "Sidedock notes" (notebook Notes), new text under a dated line
      // Usage log: localStorage "hs-notes-use" = { noteId: [timestamps] }, written here when a note is opened or saved.
      // TODO (main notes view): append to the same key when a note is opened / saved there, so POPULAR sees it too.
      title: 'QUICK NOTE',
      mount(el) {
        const MODES = ['last', 'popular', 'new'], LABEL = { last: 'LAST EDITED', popular: 'POPULAR · 36 H', new: 'NEW NOTE' }, WIN = 36 * 3600e3;
        const st = { mode: (() => { try { const m = localStorage.getItem('dockNoteMode'); return MODES.includes(m) ? m : 'last'; } catch { return 'last'; } })(), id: null, dirty: false };
        el.innerHTML = '<div class="m-h">✎ QUICK NOTE <em class="n-where"></em></div><div class="n-title"></div><textarea class="n-text" rows="3" placeholder="type a note…" spellcheck="true"></textarea><div class="m-btns"><button class="n-mode"></button><button class="n-save">SAVE</button></div><div class="m-sub n-msg"></div>';
        const ta = $('.n-text', el), msg = $('.n-msg', el), where = $('.n-where', el), mode = $('.n-mode', el), ttl = $('.n-title', el);
        const useGet = () => { try { return JSON.parse(localStorage.getItem('hs-notes-use') || '{}') || {}; } catch { return {}; } };
        const useAdd = (id) => {
          try {
            const u = useGet(), now = Date.now(), cut = now - WIN;
            for (const k of Object.keys(u)) { u[k] = (u[k] || []).filter((t) => t > cut); if (!u[k].length) delete u[k]; }
            (u[id] = u[id] || []).push(now);
            localStorage.setItem('hs-notes-use', JSON.stringify(u)); // local fallback only
          } catch {}
          hs.call('notesUse', id).catch(() => {}); // the real log lives in the main process (shared with the notes page)
        };
        const upd = (n) => (typeof n.updated === 'number' ? n.updated : Date.parse(n.updated) || 0);
        const pick = async () => {
          const l = (await hs.call('notesList')).filter((n) => !n.deleted && !n.journal);
          if (!l.length) return null;
          const newest = l.reduce((a, b) => (upd(b) > upd(a) ? b : a));
          if (st.mode === 'last') return newest;
          let u; try { u = (await hs.call('notesUseList')) || {}; } catch { u = useGet(); }
          const cut = Date.now() - WIN;
          const cnt = (n) => (u[n.id] || []).filter((t) => t > cut).length;
          const ranked = l.map((n) => [n, cnt(n)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || upd(b[0]) - upd(a[0]));
          return ranked.length ? ranked[0][0] : newest;
        };
        const fail = (e) => { msg.textContent = /locked|unlock/i.test(e.message) ? 'open HYPERSPACE once and type your password' : String(e.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); };
        const label = async (force) => {
          mode.textContent = `MODE: ${LABEL[st.mode]}`; mode.title = 'Click to switch: LAST EDITED, POPULAR, NEW NOTE';
          try {
            if (st.mode === 'new') {
              where.textContent = 'NEW'; ttl.textContent = '→ page “Sidedock notes” (Notes)'; ta.placeholder = 'new text goes under a dated line…';
              if (force) { ta.value = D.noteDraft || ''; st.dirty = !!ta.value; st.id = null; }
              return;
            }
            ta.placeholder = 'type to edit this note…';
            const n = await pick();
            if (!n) { where.textContent = ''; ttl.textContent = 'no notes yet'; st.id = null; return; }
            where.textContent = st.mode === 'last' ? 'LAST' : 'POPULAR';
            ttl.textContent = `${n.title || 'Untitled'}  ·  ${[n.notebook, n.section].filter(Boolean).join(' › ')}`;
            if (force || (!st.dirty && document.activeElement !== ta && n.id !== st.id)) {
              const full = await hs.call('notesGet', n.id);
              if (full) { ta.value = full.body || ''; st.dirty = false; }
            }
            if (n.id !== st.id) { st.id = n.id; useAdd(n.id); }
          } catch { where.textContent = 'notes locked'; ttl.textContent = ''; }
        };
        mode.addEventListener('click', () => {
          if (st.mode === 'new') D.noteDraft = ta.value;
          st.mode = MODES[(MODES.indexOf(st.mode) + 1) % MODES.length]; st.dirty = false; st.id = null;
          try { localStorage.setItem('dockNoteMode', st.mode); } catch {}
          label(true);
        });
        const stamp = () => new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const save = async () => {
          const text = ta.value.trim();
          if (!text && st.mode === 'new') return;
          try {
            if (st.mode === 'new') {
              const l = (await hs.call('notesList')).filter((n) => !n.deleted && !n.journal && n.title === 'Sidedock notes' && (n.notebook || 'Notes') === 'Notes');
              const add = `**${stamp()}**\n${text}`;
              if (l.length) {
                const page = l.reduce((a, b) => (upd(b) > upd(a) ? b : a)), full = await hs.call('notesGet', page.id);
                await hs.call('notesSave', { ...full, body: `${(full.body || '').replace(/\s+$/, '')}\n\n${add}\n` });
                useAdd(page.id);
              } else {
                const r = await hs.call('notesSave', { title: 'Sidedock notes', notebook: 'Notes', section: '', body: `${add}\n` });
                if (r?.id) useAdd(r.id);
              }
              ta.value = ''; D.noteDraft = ''; st.dirty = false; msg.textContent = 'added to “Sidedock notes” ✓';
            } else {
              if (!st.id) return;
              const full = await hs.call('notesGet', st.id);
              if (!full) throw new Error('that note is gone');
              await hs.call('notesSave', { ...full, body: ta.value });
              useAdd(st.id); st.dirty = false; msg.textContent = 'saved ✓';
            }
            setTimeout(() => { msg.textContent = ''; }, 3000); label();
          } catch (e) { fail(e); }
        };
        $('.n-save', el).addEventListener('click', save);
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
        ta.addEventListener('input', () => { st.dirty = true; if (st.mode === 'new') D.noteDraft = ta.value; });
        // the dock normally ignores the keyboard; let it have it while this box is in use
        ta.addEventListener('focus', () => hs.call('dockTyping', true));
        ta.addEventListener('blur', () => hs.call('dockTyping', false));
        el.addEventListener('mousedown', (e) => { if (e.target === ta) hs.call('dockTyping', true); });
        label(true); el._label = () => label(false);
      },
      update(el) { const now = Date.now(); if (now - (el._lt || 0) > 20000) { el._lt = now; el._label?.(); } },
    },
    todo: {
      // TO-DO: the top 5 open items of your personal list (todo.json, same file as the TO-DO page). Tick to finish, type to add.
      title: 'TO-DO',
      mount(el) {
        el.innerHTML = '<div class="m-h m-link" title="Open the TO-DO page">✔ TO-DO <em class="t-n"></em></div><div class="m-list t-list"></div><input class="t-new" placeholder="add a to-do… (Enter)" spellcheck="true" /><div class="m-sub t-msg"></div>';
        const list = $('.t-list', el), inp = $('.t-new', el);
        const fresh = async () => { const s = await hs.call('todoGet'); return s && typeof s === 'object' ? s : { tasks: [] }; };
        const refresh = async () => { try { D.todo = await fresh(); } catch {} render(); };
        el._refresh = refresh;
        $('.m-h', el).addEventListener('click', () => {
          if (D.dragMoved) return;
          try { localStorage.setItem('view', 'todo'); } catch {}
          hs.call('dockOpenView', 'todo').catch(() => {}).finally(() => hs.call('dockSummon').catch(() => {}));
        });
        list.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-t]');
          if (!b) return;
          try {
            const s = await fresh(), t = (s.tasks || []).find((x) => x.id === b.dataset.t);
            if (t) { t.done = true; t.doneAt = Date.now(); await hs.call('todoSave', s); }
          } catch {}
          refresh();
        });
        const add = async () => {
          const v = inp.value.trim();
          if (!v) return;
          try {
            const s = await fresh(); s.tasks = s.tasks || [];
            s.tasks.push({ id: Date.now().toString(36), text: v, done: false, at: Date.now() });
            await hs.call('todoSave', s); inp.value = '';
          } catch { $('.t-msg', el).textContent = 'could not save'; }
          refresh();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        inp.addEventListener('focus', () => hs.call('dockTyping', true));
        inp.addEventListener('blur', () => hs.call('dockTyping', false));
        el.addEventListener('mousedown', (e) => { if (e.target === inp) hs.call('dockTyping', true); });
        refresh();
      },
      update(el) {
        const open = (D.todo?.tasks || []).filter((t) => !t.done);
        $('.t-n', el).textContent = D.todo ? `${open.length} OPEN` : '';
        // the header pulses amber when an item is past its due date, or when more than 8 items are open
        $('.m-h', el)?.classList.toggle('pulse-warn', open.length > 8 || open.some((t) => t.due && new Date(t.due).getTime() < Date.now()));
        const html = open.slice(0, 5).map((t) => `<div class="t-row"><button data-t="${esc(t.id)}" title="Tick it off">☐</button><span title="${esc(t.text)}">${esc(t.text)}</span></div>`).join('') || '<div class="m-sub">nothing open ✓</div>';
        const l = $('.t-list', el);
        if (l._h !== html) { l._h = html; l.innerHTML = html; }
      },
    },
    vacuum: {
      title: 'MEMORY VACUUM',
      mount(el) {
        el.innerHTML = '<div class="m-h">⌬ VACUUM <em></em></div><div class="m-btns"><button class="vc-go" title="Frees RAM: empties standby memory and trims idle apps (needs HyperCore running as admin)">CLEAN RAM</button></div><div class="m-sub vc-msg">click to free memory</div>';
        const b = $('.vc-go', el), msg = $('.vc-msg', el);
        b.addEventListener('click', async () => {
          if (b.disabled) return;
          b.disabled = true; b.textContent = 'CLEANING…'; msg.textContent = '';
          try {
            const r = await core('mem.run', { trim: true });
            const freed = r.availableAfter - r.availableBefore;
            msg.textContent = freed > 0 ? `freed ${bytes(freed)}${r.trimmed ? ` · ${r.trimmed} apps trimmed` : ''}` : 'nothing more to free';
          } catch (e) { msg.textContent = String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').slice(0, 80); }
          b.disabled = false; b.textContent = 'CLEAN RAM';
        });
      },
      update(el) { const m = D.perf?.mem; if (m) $('em', el).textContent = `${bytes(m.total - m.used)} free`; },
    },
    uptime: {
      title: 'UPTIME',
      mount(el) { el.innerHTML = '<div class="m-h">⏱ UPTIME</div><div class="m-big"></div><div class="m-sub">since the last restart</div>'; },
      update(el) { const u = D.perf?.uptime; if (u == null) return; const d = Math.floor(u / 86400), h = Math.floor((u % 86400) / 3600), m = Math.floor((u % 3600) / 60); $('.m-big', el).textContent = `${d ? d + 'd ' : ''}${h}h ${m}m`; },
    },
  };
  window.SIDE_DOCK_MODULES =Object.fromEntries(Object.entries(MODS).map(([k, m]) => [k, m.title]));

  // ---------------- layout ----------------
  let cfg = null, key = '';
  const sd = $('#sd');
  const P = () => cfg.place || { type: 'edge', edge: 'right' };
  const autoHide = () => cfg.mode === 'auto';
  function build() {
    const p = P(), side = p.type === 'edge' ? p.edge : p.type === 'window' && p.corner?.endsWith('l') ? 'left' : 'right';
    const k = JSON.stringify([cfg.modules, cfg.opacity]);
    sd.className = `sd ${p.type} ${side}${autoHide() ? ' auto' : ''}${open ? ' open' : ''}${cfg.pinned ? ' pinned' : ''}${dragging ? ' dragging' : ''}`;
    document.documentElement.style.setProperty('--op', cfg.opacity);
    $('.sd-where').textContent = `${cfg.where || ''}${cfg.pinned ? ' · ON TOP' : ''}`;
    if (k === key) return;
    key = k;
    const box = $('#sd-mods');
    box.innerHTML = '';
    for (const id of cfg.modules) {
      if (!MODS[id]) continue;
      const el = document.createElement('div');
      el.className = `m m-${id}`;
      MODS[id].mount(el);
      box.append(el);
    }
    render();
  }
  function render() {
    for (const el of document.querySelectorAll('#sd-mods .m')) {
      const id = [...el.classList].find((c) => c.startsWith('m-') && MODS[c.slice(2)])?.slice(2);
      try { MODS[id]?.update(el); } catch {}
    }
  }

  // ---------------- drag a module to reorder: press and hold its header (or move 6 px), drop where you want it ----------------
  // Pointer events with capture on the header, so it works in this non-focusable window. The other modules slide
  // aside with a transform transition; the amber line shows where it will land. The order is saved via dockSet.
  (() => {
    const box = $('#sd-mods'), GAP = 8;
    let g = null;
    const mods = () => [...box.children].filter((c) => c.classList.contains('m'));
    const idOf = (el) => [...el.classList].find((c) => c.startsWith('m-') && MODS[c.slice(2)])?.slice(2);
    const place = (y) => {
      const mid = g.items.map((r) => r.top + r.h / 2), c = g.top + g.h / 2 + (y - g.y0);
      let to = 0;
      g.items.forEach((r, i) => { if (i !== g.from && mid[i] < c) to++; });
      g.to = to;
      const step = g.h + GAP;
      g.items.forEach((r, i) => {
        if (i === g.from) return;
        let dy = 0;
        if (to > g.from && i > g.from && i <= to) dy = -step;
        if (to < g.from && i >= to && i < g.from) dy = step;
        g.els[i].style.transform = dy ? `translateY(${dy}px)` : '';
      });
      // marker where it will land
      const slot = to > g.from ? g.items[to].top + g.items[to].h - g.h : g.items[to].top;
      g.mark.style.top = `${Math.max(0, slot - GAP / 2 - 1)}px`;
    };
    const lift = (e) => {
      const els = mods(), from = els.indexOf(g.el);
      Object.assign(g, { els, from, items: els.map((m) => ({ top: m.offsetTop, h: m.offsetHeight })), to: from });
      g.top = g.items[from].top; g.h = g.items[from].h;
      g.mark = document.createElement('div'); g.mark.className = 'dk-mark'; box.append(g.mark);
      g.el.classList.add('lifted'); box.classList.add('reordering');
      g.lifted = true; D.dragMoved = true;
      g.y0 = e.clientY - (box.scrollTop - g.scroll0);
      place(e.clientY);
    };
    const finish = async (commit) => {
      if (!g) return;
      clearTimeout(g.timer);
      const was = g;
      g = null;
      try { was.head.releasePointerCapture(was.pid); } catch {}
      if (was.lifted) {
        was.el.classList.remove('lifted'); box.classList.remove('reordering'); was.mark?.remove();
        was.els.forEach((m) => { m.style.transform = ''; });
        if (commit && was.to !== was.from) { was.el.classList.remove('settle'); void was.el.offsetWidth; was.el.classList.add('settle'); setTimeout(() => was.el.classList.remove('settle'), 600); } // small settle bounce (the dock has no rabbit)
        setTimeout(() => { D.dragMoved = false; }, 0);
        if (commit && was.to !== was.from) {
          const arr = was.els.slice(); arr.splice(was.from, 1); arr.splice(was.to, 0, was.el);
          arr.forEach((m) => box.append(m));
          const next = [...arr.map(idOf), ...(cfg.modules || []).filter((m) => !MODS[m])];
                    cfg.modules = next; key = JSON.stringify([cfg.modules, cfg.opacity]); // same layout as what the app will push back: no rebuild
          try { await hs.call('dockSet', { modules: next }); } catch {}
        }
      }
    };
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || g || dragging) return;
      const head = e.target.closest('.m-h');
      if (!head || e.target.closest('button, textarea, input, select, a')) return;
      const el = head.closest('.m');
      if (!el) return;
      g = { el, head, pid: e.pointerId, x0: e.clientX, y0: e.clientY, scroll0: box.scrollTop, lifted: false };
      try { head.setPointerCapture(e.pointerId); } catch {}
      g.timer = setTimeout(() => { if (g && !g.lifted) lift({ clientY: g.y0 }); }, 250);
    });
    box.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.pid) return;
      if (!g.lifted) { if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 6) return; clearTimeout(g.timer); lift({ clientY: g.y0 }); }
      const dy = e.clientY - g.y0 + (box.scrollTop - g.scroll0);
      g.el.style.transform = `translateY(${dy}px)`;
      place(e.clientY);
    });
    box.addEventListener('pointerup', (e) => { if (g && e.pointerId === g.pid) finish(true); });
    box.addEventListener('pointercancel', () => finish(false));
    window.addEventListener('blur', () => finish(false));
  })();

  // ---------------- slide out / back (auto mode) ----------------
  // the app watches the cursor and says when to slide out / away
  let open = false, dragging = false;
  hs.on('dock-open', (v) => { open = !!v; sd.classList.toggle('open', open); });
  $('.sd-open').addEventListener('click', () => hs.call('dockSummon'));
  document.querySelectorAll('.sd-layer').forEach((b) => b.addEventListener('click', async () => { cfg = await hs.call('dockLayer'); build(); }));

  // ---------------- drag: grab the title bar, drop on an edge, a window's corner, or anywhere ----------------
  $('.sd-top').addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    dragging = true; build();
    hs.call('dockDrag', 'start');
  });
  const endDrag = async () => {
    if (!dragging) return;
    dragging = false;
    $('.sd-drop').classList.add('hidden');
    cfg = await hs.call('dockDrag', 'end');
    open = true;
    build();
  };
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);
  hs.on('dock-drag', (d) => {
    const el = $('.sd-drop');
    el.classList.toggle('hidden', !d.on || !d.label);
    if (d.label) el.textContent = `DROP → ${d.label}`;
  });

  // ---------------- data ----------------
  hs.on('telemetry', (t) => { D.tele = t; });
  // lite mode: the dock snaps in and out and drops its glow and blur
  const lite = (s) => document.body.classList.toggle('lite', !!s?.on);
  hs.on('lite', lite);
  // purple accents follow the main window's switch (Settings → LOOK)
  const look = (c) => window.applyAccent(c?.look);
  hs.on('config', look);
  hs.call('config').then(look).catch(() => {});
  hs.call('liteGet').then(lite).catch(() => {});
  hs.on('vpn', (v) => { D.vpn = v; render(); });
  hs.on('dock-config', (c) => { cfg = c; build(); });
  hs.on('dock-data', (d) => { D[d.key] = d.value; render(); });
  const want = (m) => cfg?.modules?.includes(m);
  async function poll() {
    try { if (['cpu', 'gpu', 'ram', 'net', 'disk', 'drives', 'battery', 'uptime'].some(want)) D.perf = await hs.call('perf'); } catch {}
    render();
  }
  setInterval(poll, 2000);
  hs.on('hw-state', (h) => { if (want('shield')) { D.hw = h; render(); } }); // pushed when Windows' mic / camera state changes
  async function slowPoll(now = false) {
    // hidden (covered by a game, its window minimised) or slid away: nothing to show, so nothing to ask for
    if (!now && !(await hs.call('seen').catch(() => true))) return;
    if (want('media')) core('media.get').then((m) => { D.media = m; }).catch(() => {});
    if (want('shield')) hs.call('hwState').then((h) => { D.hw = h; }).catch(() => {});
    if (want('apps')) hs.call('procs').then((p) => { D.procs = p; }).catch(() => {});
    if (want('todo')) hs.call('todoGet').then((t) => { D.todo = t || { tasks: [] }; }).catch(() => {});
    if (want('volume')) core('audio.getVolume').then((v) => { D.vol = v; }).catch(() => {});
  }
  setInterval(slowPoll, 3000);
  hs.on('dock-open', (v) => { if (v) { slowPoll(true); poll(); } }); // slid back out: fresh numbers straight away
  setInterval(() => { if (want('thermals')) hs.call('thermalHistory', Date.now() - 1800e3).then((r) => { D.thermal = r || []; }).catch(() => {}); }, 10000);
  setInterval(() => { if (want('clock')) render(); }, 15000);
  (async () => {
    cfg = await hs.call('dockGet');
    D.vpn = await hs.call('vpnStatus').catch(() => null);
    if (want('thermals')) D.thermal = await hs.call('thermalHistory', Date.now() - 1800e3).catch(() => []);
    build();
    poll();
  })();
})();
