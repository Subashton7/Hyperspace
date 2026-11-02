// Phone mode: when the page is served by the phone-link server (no Electron preload), provide the same
// `hs` surface over HTTP. The pairing key arrives in the URL fragment once, then lives in localStorage.
(() => {
  if (window.hs) return;
  // Encrypted only: on the plain http address (a new phone's first visit) the key is never sent anywhere.
  // The phone app shows how to reach the encrypted address instead; any other page goes there.
  const PLAIN = location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (PLAIN && !/\/phone\.html$/.test(location.pathname)) { location.replace(`/renderer/phone.html${location.hash}`); return; }
  let key = null;
  const m = location.hash.match(/k=([\w-]+)/);
  try {
    // (on the secure door the key stays in the address, so "Add to Home Screen" saves a paired app)
    if (m) { localStorage.setItem('hs-key', m[1]); if (location.protocol !== 'https:') history.replaceState(null, '', location.pathname + location.search); }
    key = localStorage.getItem('hs-key');
  } catch { key = m && m[1]; }

  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  function unpaired() {
    if (document.getElementById('pair-gate')) return;
    const d = document.createElement('div');
    d.id = 'pair-gate';
    d.innerHTML = '<div class="pair-box"><div class="glitch big" data-text="NOT PAIRED">NOT PAIRED</div>' +
      '<p>On the laptop open HYPERSPACE → <b>LINK</b> and scan the QR code with this phone.</p></div>';
    document.body.appendChild(d);
  }

  async function call(name, ...args) {
    if (PLAIN) throw new Error('encrypted connection required');
    const r = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HS-Key': key || '' },
      body: JSON.stringify({ name, args }),
    });
    if (r.status === 401) { unpaired(); throw new Error('not paired'); }
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  }

  async function stream() {
    for (;;) {
      try {
        const r = await fetch('/api/events', { headers: { 'X-HS-Key': key || '' } });
        if (r.status === 401) { unpaired(); return; }
        emit('link', { connected: true });
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let ev = 'message', data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) ev = line.slice(7);
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if (data) { try { emit(ev, JSON.parse(data)); } catch {} }
          }
        }
      } catch {}
      emit('link', { connected: false });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  window.hs = {
    remote: true,
    call,
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    win: () => {},
    // CRATE tracks / covers streamed from the laptop (the key rides in the query: <audio> can't send headers)
    media: (kind, id) => (PLAIN ? '' : `/media/${kind}/${encodeURIComponent(id)}?k=${encodeURIComponent(key || '')}`),
    key: () => key,
    plain: PLAIN,
  };
  document.documentElement.classList.add('remote');
  window.HS_ASSET = (n) => `/assets/${n}`; // the laptop's hsmedia://asset/… as the phone link serves it
  if (!PLAIN) stream();
})();
