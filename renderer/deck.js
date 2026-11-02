// DECK: master mute + volume, audio output switching, media transport, display modes/arrangement.
(() => {
  let vol = null;
  let media = null;
  let showVirtual = false;
  let pending = null; // { token, until }

  const ICONS = {
    speakers: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
    bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
    display: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
    interface: '<rect x="3" y="7" width="18" height="10" rx="1"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
    virtual: '<path d="M4 12h4l3-6 3 12 3-6h3"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${ICONS[k] || ICONS.interface}</g></svg>`;

  // ---------------- master ----------------
  function renderVol() {
    if (!vol) return;
    HS.data.vol = vol;
    $('#deck-mute').classList.toggle('on', vol.muted);
    $('#deck-mute b').textContent = vol.muted ? 'MUTED' : 'MUTE';
    if (document.activeElement !== $('#deck-vol')) $('#deck-vol').value = Math.round(vol.level * 100);
    $('#deck-vol-v').textContent = `${Math.round(vol.level * 100)}%`;
    $('#deck-dev').textContent = vol.device || '—';
  }
  async function refreshVol() { try { vol = await coreCall('audio.getVolume'); renderVol(); } catch {} }
  $('#deck-mute').addEventListener('click', async () => {
    try { vol = await coreCall('audio.volume', { muted: !(vol?.muted) }); renderVol(); toast(vol.muted ? 'MASTER MUTED' : 'MASTER LIVE', vol.muted); }
    catch (e) { toast(e.message, true); }
  });
  let volTimer;
  $('#deck-vol').addEventListener('input', (e) => {
    $('#deck-vol-v').textContent = `${e.target.value}%`;
    clearTimeout(volTimer);
    volTimer = setTimeout(async () => { try { vol = await coreCall('audio.volume', { level: e.target.value / 100 }); renderVol(); } catch {} }, 60);
  });

  // level meter from the FFT stream
  const meter = $('#deck-meter');
  let spec = null;
  hs.on('audio', (d) => { spec = d; });
  // sized only when the meter's box changes (setting a canvas' size every frame reallocates it)
  const sizeMeter = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = meter.getBoundingClientRect();
    meter.width = Math.round(r.width * dpr); meter.height = Math.round(r.height * dpr);
  };
  new ResizeObserver(sizeMeter).observe(meter);
  let meterOn = false;
  function drawMeter() {
    if (HS.view !== 'deck') { meterOn = false; return; } // no frames while another tab shows (HS.onView restarts it)
    requestAnimationFrame(drawMeter);
    if (!spec) return;
    const ctx = meter.getContext('2d');
    ctx.clearRect(0, 0, meter.width, meter.height);
    const n = spec.s.length, bw = meter.width / n;
    for (let i = 0; i < n; i++) {
      const v = spec.s[i] / 255, h = v * meter.height;
      ctx.fillStyle = `hsla(${140 + v * 30},100%,${45 + v * 25}%,0.9)`;
      ctx.fillRect(i * bw + 1, meter.height - h, bw - 2, h);
    }
  }
  const startMeter = () => { if (!meterOn && HS.view === 'deck') { meterOn = true; requestAnimationFrame(drawMeter); } };
  HS.onView(startMeter);
  startMeter();

  // ---------------- transport ----------------
  function renderMedia(m) {
    media = m;
    HS.data.media = m;
    $('#np-title').textContent = m?.available ? (m.title || 'unknown track') : 'nothing playing';
    $('#np-artist').innerHTML = m?.available && m.artist ? esc(m.artist) : '&nbsp;';
    $('#np-app').innerHTML = m?.available ? esc((m.app || '').split('.')[0].split('!')[0]) : '&nbsp;';
    $('#np-toggle').classList.toggle('playing', m?.status === 'playing');
  }
  hs.on('media', renderMedia);
  $$('[data-media]').forEach((b) => b.addEventListener('click', async () => {
    try { renderMedia(await coreCall('media.cmd', { action: b.dataset.media })); } catch (e) { toast(e.message, true); }
  }));

  // ---------------- outputs ----------------
  async function refreshOutputs() {
    try {
      const d = await coreCall('audio.devices');
      const real = d.outputs.filter((o) => o.kind !== 'virtual'), virt = d.outputs.filter((o) => o.kind === 'virtual');
      // "Speakers (John's JBL Flip 7)" -> headline "John's JBL Flip 7", subline "Speakers"
      const split = (n) => { const m = n.match(/^(.*?)\s*\((.*)\)$/); return m ? [m[2], m[1]] : [n, '']; };
      const card = (o) => { const [main, sub] = split(o.name); return `<button class="dev${o.isDefault ? ' on' : ''}" data-id="${esc(o.id)}" title="${esc(o.name)}">${icon(o.kind)}<span>${esc(main)}</span><span class="dim tiny">${esc(sub || o.kind)}</span></button>`; };
      $('#deck-outputs').innerHTML = real.map(card).join('') + (showVirtual ? virt.map(card).join('') : '') +
        (virt.length ? `<button class="dev" id="toggle-virtual">${icon('virtual')}<span>${showVirtual ? 'hide' : 'show'} ${virt.length} virtual</span></button>` : '');
    } catch (e) { $('#deck-outputs').innerHTML = `<div class="dim">${esc(e.message)}</div>`; }
  }
  $('#deck-outputs').addEventListener('click', async (e) => {
    if (e.target.closest('#toggle-virtual')) { showVirtual = !showVirtual; return refreshOutputs(); }
    const b = e.target.closest('.dev[data-id]');
    if (!b) return;
    try { await coreCall('audio.default', { id: b.dataset.id }); toast(`OUTPUT → ${b.title}`); refreshOutputs(); refreshVol(); }
    catch (er) { toast(er.message, true); }
  });

  // ---------------- displays ----------------
  async function refreshDisplays() {
    try {
      const d = await coreCall('display.list');
      $$('#deck-topo button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.topology));
      $('#deck-displays').innerHTML = d.displays.map((m) => {
        const hzs = [...new Set(m.modes.filter((x) => x[0] === m.width && x[1] === m.height).map((x) => x[2]))].sort((a, b) => a - b);
        const res = [...new Map(m.modes.map((x) => [`${x[0]}x${x[1]}`, x])).values()];
        const title = m.internalPanel ? 'LAPTOP SCREEN' : 'EXTERNAL MONITOR';
        return `<div class="disp-card" data-device="${esc(m.device)}">
          <h6>${title}${m.primary ? ' · PRIMARY' : ''}<span>${esc(m.adapter)}</span></h6>
          <div class="hz-row">${hzs.map((hz) => `<button data-w="${m.width}" data-h="${m.height}" data-hz="${hz}" class="${hz === m.hz ? 'on' : ''}">${hz} Hz</button>`).join('')}</div>
          <select data-res>${res.map((x) => `<option value="${x[0]}x${x[1]}"${x[0] === m.width && x[1] === m.height ? ' selected' : ''}>${x[0]} × ${x[1]}</option>`).join('')}</select>
        </div>`;
      }).join('');
      for (const sel of $$('#deck-displays select[data-res]')) sel._modes = d.displays.find((x) => x.device === sel.closest('.disp-card').dataset.device).modes;
    } catch (e) { $('#deck-displays').innerHTML = `<div class="dim" style="padding:14px">${esc(e.message)}</div>`; }
  }
  async function applyMode(device, w, h, hz) {
    try {
      const r = await coreCall('display.set', { device, w, h, hz });
      armKeep(r.token);
      setTimeout(refreshDisplays, 800);
    } catch (e) { toast(e.message, true); }
  }
  $('#deck-displays').addEventListener('click', (e) => {
    const b = e.target.closest('.hz-row button');
    if (!b || b.classList.contains('on')) return;
    applyMode(b.closest('.disp-card').dataset.device, +b.dataset.w, +b.dataset.h, +b.dataset.hz);
  });
  $('#deck-displays').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-res]');
    if (!sel) return;
    const [w, h] = sel.value.split('x').map(Number);
    const best = sel._modes.filter((x) => x[0] === w && x[1] === h).sort((a, b) => b[2] - a[2])[0];
    applyMode(sel.closest('.disp-card').dataset.device, w, h, best[2]);
  });
  $('#deck-topo').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    try { const r = await coreCall('display.topology', { mode: b.dataset.v }); armKeep(r.token); setTimeout(refreshDisplays, 1500); }
    catch (er) { toast(er.message, true); }
  });

  let keepTimer;
  function armKeep(token) {
    pending = { token, until: Date.now() + 15000 };
    $('#keep-bar').classList.remove('hidden');
    clearInterval(keepTimer);
    const tick = () => {
      const s = Math.max(0, Math.ceil((pending.until - Date.now()) / 1000));
      $('#keep-s').textContent = s;
      if (!s) { clearInterval(keepTimer); $('#keep-bar').classList.add('hidden'); }
    };
    tick();
    keepTimer = setInterval(tick, 250);
  }
  $('#keep-yes').addEventListener('click', async () => {
    if (!pending) return;
    try { await coreCall('display.keep', { token: pending.token }); toast('DISPLAY SETTING KEPT'); } catch {}
    pending = null; clearInterval(keepTimer); $('#keep-bar').classList.add('hidden');
  });
  $('#keep-no').addEventListener('click', async () => {
    if (!pending) return;
    try { await coreCall('display.revert', { token: pending.token }); } catch {}
    pending = null; clearInterval(keepTimer); $('#keep-bar').classList.add('hidden');
  });
  hs.on('display-reverted', () => { toast('DISPLAY REVERTED'); $('#keep-bar').classList.add('hidden'); pending = null; setTimeout(refreshDisplays, 800); });

  // ---------------- lifecycle ----------------
  const leaseId = hs.remote ? `phone-deck-${Math.random().toString(36).slice(2, 7)}` : 'deck';
  function enter() {
    refreshVol(); refreshOutputs(); refreshDisplays();
    coreCall('media.get').then(renderMedia).catch(() => {});
  }
  HS.onView((v) => {
    if (v === 'deck') enter();
    hs.call('audioLease', leaseId, v === 'deck').catch(() => {});
  });
  setInterval(() => {
    if (HS.view === 'deck') hs.call('audioLease', leaseId, true).catch(() => {});
    if (HS.core.state === 'online') refreshVol(); // the volume widget can sit on any page
  }, 4000);
  HS.actions.media = (a) => coreCall('media.cmd', { action: a }).then(renderMedia).catch((e) => toast(e.message, true));
  HS.actions.mute = () => $('#deck-mute').click();
  HS.actions.volume = (v) => coreCall('audio.volume', { level: v }).then((r) => { vol = r; renderVol(); }).catch(() => {});
  hs.on('core', (s) => { if (s.state === 'online' && HS.view === 'deck') enter(); });
})();
