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
