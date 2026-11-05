// CRATE audio engine: two decks through Web Audio. Each deck runs
//   <audio> → 3-band isolator (lows / mids / highs, each with a kill) → filter sweep → channel fader → crossfader → master
// The player uses the decks in turn for crossfaded transitions; the DJ page drives them by hand.
// Tracks stream over hsmedia:// with CORS, which keeps the audio usable by the graph.
window.CrateEngine = (() => {
  const ctx = new AudioContext({ latencyHint: 'playback' });
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const LOW_X = 250, HIGH_X = 2500; // crossover points, like a DJ mixer's isolator
  const bq = (type, f, q = Math.SQRT1_2) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); };
  const dbToGain = (d) => Math.pow(10, d / 20);

  function makeDeck(name) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.preservesPitch = true;
    const src = ctx.createMediaElementSource(el);
    const sum = ctx.createGain();
    // two stacked Butterworths per edge (Linkwitz-Riley): the three bands add back up flat
    const gLow = ctx.createGain(), gMid = ctx.createGain(), gHigh = ctx.createGain();
    chain(src, bq('lowpass', LOW_X), bq('lowpass', LOW_X), gLow, sum);
    chain(src, bq('highpass', LOW_X), bq('highpass', LOW_X), bq('lowpass', HIGH_X), bq('lowpass', HIGH_X), gMid, sum);
    chain(src, bq('highpass', HIGH_X), bq('highpass', HIGH_X), gHigh, sum);
    const filt = bq('allpass', 1000, 1);
    const vol = ctx.createGain(), xf = ctx.createGain(), an = ctx.createAnalyser();
    an.fftSize = 512;
    chain(sum, filt, vol, xf, master);
    vol.connect(an);
    return {
      name, el, gLow, gMid, gHigh, filt, vol, xf, an,
      track: null, wave: null, hi: null, feat: null, grid: null, nbpm: 0,
      eq: { low: 0, mid: 0, high: 0 }, kill: { low: false, mid: false, high: false }, filter: 0, pitch: 0, cue: 0, fader: 1,
    };
  }
  const A = makeDeck('A'), B = makeDeck('B');
  const E = {
    ctx, A, B, decks: [A, B], xf: 0,
    other: (d) => (d === A ? B : A),
    resume() { if (ctx.state !== 'running') ctx.resume().catch(() => {}); },

    applyEq(d) {
      const t = ctx.currentTime;
      for (const [band, node] of [['low', d.gLow], ['mid', d.gMid], ['high', d.gHigh]]) node.gain.setTargetAtTime(d.kill[band] ? 0 : dbToGain(d.eq[band]), t, 0.012);
    },
    setEq(d, band, dbv) { d.eq[band] = Math.max(-26, Math.min(6, dbv)); E.applyEq(d); },
    setKill(d, band, on) { d.kill[band] = on; E.applyEq(d); },
    // -1 … 0 … +1: low-pass sweep down, off, high-pass sweep up
    setFilter(d, v) {
      d.filter = Math.max(-1, Math.min(1, v));
      const f = d.filt, t = ctx.currentTime;
      if (Math.abs(d.filter) < 0.02) { f.type = 'allpass'; return; }
      if (d.filter < 0) { f.type = 'lowpass'; f.frequency.setTargetAtTime(20000 * Math.pow(0.0015, -d.filter), t, 0.02); }
      else { f.type = 'highpass'; f.frequency.setTargetAtTime(20 * Math.pow(500, d.filter), t, 0.02); }
      f.Q.value = 1.2;
    },
    setFader(d, v) { d.fader = Math.max(0, Math.min(1, v)); d.vol.gain.setTargetAtTime(d.fader * d.fader, ctx.currentTime, 0.01); },
    // equal-power crossfader, 0 = all A, 1 = all B
    setXf(x) {
      E.xf = Math.max(0, Math.min(1, x));
      const t = ctx.currentTime;
      A.xf.gain.setTargetAtTime(Math.cos(E.xf * Math.PI / 2), t, 0.01);
      B.xf.gain.setTargetAtTime(Math.sin(E.xf * Math.PI / 2), t, 0.01);
    },
    setPitch(d, pct) { d.pitch = Math.max(-16, Math.min(16, pct)); d.el.playbackRate = 1 + d.pitch / 100; },
    setKeyLock(d, on) { d.el.preservesPitch = on; },
    setMaster(v) { master.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
    async setSink(id) { if (ctx.setSinkId) await ctx.setSinkId(id || ''); },
    resetDeck(d) {
      d.eq = { low: 0, mid: 0, high: 0 }; d.kill = { low: false, mid: false, high: false };
      E.applyEq(d); E.setFilter(d, 0); E.setPitch(d, 0);
    },
    load(d, track, url) {
      d.track = track; d.wave = null; d.hi = null; d.cue = 0; d.grid = null; d.nbpm = 0;
      d.el.src = url;
      return new Promise((res) => {
        const done = () => { d.el.removeEventListener('loadedmetadata', done); d.el.removeEventListener('error', done); res(); };
        d.el.addEventListener('loadedmetadata', done); d.el.addEventListener('error', done);
      });
    },
    bpmNow: (d) => E.bpmNative(d) * d.el.playbackRate,
    // the beat grid a deck mixes by: rekordbox's, else one found by listening (E.ensureGrid)
    gridOf: (d) => (d.wave?.beats?.length ? d.wave.beats : d.grid || null),
    // the track's own tempo (before pitch), measured from the grid when there is one
    bpmNative(d) {
      const g = E.gridOf(d);
      if (g && g.length > 8) {
        const iv = [];
        for (let i = Math.floor(g.length / 4); i < Math.min(g.length - 1, Math.floor(g.length / 4) + 96); i++) iv.push(g[i + 1][0] - g[i][0]);
        iv.sort((a, b) => a - b);
        const m = iv[iv.length >> 1];
        if (m > 200 && m < 2000) return 60000 / m;
      }
      return d.nbpm || d.track?.bpm || 0;
    },
    // where a deck is in its beat grid: { beat index, fraction into the beat, beat-in-bar, beat length s }
    phase(d) {
      const beats = E.gridOf(d);
      if (!beats?.length) return null;
      const ms = d.el.currentTime * 1000;
      let lo = 0, hi = beats.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m][0] <= ms) lo = m; else hi = m - 1; }
      const cur = beats[lo], nx = beats[Math.min(beats.length - 1, lo + 1)];
      const len = Math.max(1, (nx[0] - cur[0]) || 60000 / (cur[2] || 140)) / 1000;
      return { i: lo, frac: Math.max(0, Math.min(1, (ms / 1000 - cur[0] / 1000) / len)), inBar: cur[1], len };
    },
    // match tempo to the other deck, then line the beats (and the bar) up
    sync(d) {
      const m = E.other(d);
      if (!d.track?.bpm || !m.track?.bpm) return false;
      let ratio = E.bpmNow(m) / d.track.bpm;
      if (ratio > 1.5) ratio /= 2; else if (ratio < 0.67) ratio *= 2;
      E.setPitch(d, (ratio - 1) * 100);
      const pm = E.phase(m), pd = E.phase(d);
      if (pm && pd) {
        let beatShift = (pm.inBar - pd.inBar) + (pm.frac - pd.frac);
        while (beatShift > 2) beatShift -= 4;
        while (beatShift < -2) beatShift += 4;
        d.el.currentTime = Math.max(0, d.el.currentTime + beatShift * pd.len);
      }
      return true;
    },
    // Listen to a track and find its tempo and beat grid (for files rekordbox never analysed).
    // Onset energy (kick-weighted) → autocorrelation over 70–175 BPM → best phase → bar line by accent.
    // focus 'end' reads the last minute (the part a mix leaves from), 'start' the first one (what it comes in on).
    // hint = a BPM we already believe; the answer is folded to sit near it.
    async detectGrid(url, focus = 'start', hint = 0) {
      const buf = await (await fetch(url)).arrayBuffer();
      const ab = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(buf);
      const x = ab.getChannelData(0), sr = ab.sampleRate, hop = 256, dur = ab.duration;
      const from = focus === 'end' ? Math.max(0, dur - 80) : Math.min(5, dur * 0.1), to = focus === 'end' ? Math.max(from + 10, dur - 6) : Math.min(dur, from + 70);
      const i0 = Math.floor(from * sr / hop), n = Math.max(64, Math.floor((to - from) * sr / hop));
      const env = new Float32Array(n);
      let lp = 0;
      for (let k = 0; k < n; k++) {
        let lo = 0, full = 0;
        for (let j = 0; j < hop; j += 2) { const v = x[(i0 + k) * hop + j] || 0; lp += 0.06 * (v - lp); lo += lp * lp; full += v * v; }
        env[k] = Math.sqrt(lo) * 1.0 + Math.sqrt(full) * 0.35;
      }
      const on = new Float32Array(n);
      for (let k = 1; k < n; k++) on[k] = Math.max(0, env[k] - env[k - 1]);
      let mean = 0; for (const v of on) mean += v; mean /= n;
      for (let k = 0; k < n; k++) on[k] = Math.max(0, on[k] - mean);
      const at = (arr, p) => { const i = Math.floor(p); if (i < 0 || i + 1 >= arr.length) return 0; const f = p - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
      let best = 0, bestScore = -1;
      const lo = hint ? hint * 0.93 : 70, hi = hint ? hint * 1.07 : 175;
      for (let bpm = lo; bpm <= hi; bpm += 0.1) {
        const P = 60 / bpm * sr / hop;
        let sc = 0;
        for (let k = 0; k + 2 * P < n; k++) sc += on[k] * (at(on, k + P) + 0.6 * at(on, k + 2 * P) + 0.4 * at(on, k + 4 * P));
        if (!hint) sc *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.75, 2)); // people dance near 125
        if (sc > bestScore) { bestScore = sc; best = bpm; }
      }
      if (!best) return null;
      // refine: tempo to 0.02 BPM by scoring a full comb of hits at each candidate (a 0.3% error would drift 0.1 s over a minute)
      const comb = (bpm) => {
        const P = 60 / bpm * sr / hop; let bf = 0, bs = -1;
        for (let f = 0; f < P; f += 0.25) { let sc = 0, c = 0; for (let p = f; p < n - 1; p += P, c++) sc += at(on, p); sc /= c || 1; if (sc > bs) { bs = sc; bf = f; } }
        return { sc: bs, f: bf };
      };
      let ph = 0, phScore = -1;
      const centre = best;
      for (let bpm = centre - 0.4; bpm <= centre + 0.4; bpm += 0.02) { const r = comb(bpm); if (r.sc > phScore) { phScore = r.sc; ph = r.f; best = bpm; } }
      const P = 60 / best * sr / hop;
      // which of four beats is the bar line: the one with the heaviest hits
      const acc = [0, 0, 0, 0]; let kk = 0;
      for (let p = ph; p < n - 1; p += P, kk++) acc[kk % 4] += at(on, p);
      const bar = acc.indexOf(Math.max(...acc));
      const step = 60 / best, t0 = from + ph * hop / sr; // seconds of beat #0 (= the first one in the window)
      const kmin = -Math.ceil(t0 / step), kmax = Math.ceil((dur - t0) / step), beats = [];
      for (let k = kmin; k <= kmax; k++) { const t = t0 + k * step; if (t >= 0 && t <= dur) beats.push([Math.round(t * 1000), (((k - bar) % 4) + 4) % 4 + 1, best]); }
      return { bpm: best, beats, confidence: acc.length ? Math.max(...acc) / (acc.reduce((a, b) => a + b, 0) || 1) : 0 };
    },
    // make sure the deck has a grid (rekordbox's or a heard one); resolves to the beats array or null
    async ensureGrid(d, focus = 'start', url) {
      if (d.wave?.beats?.length) return d.wave.beats;
      const tr = d.track;
      if (!tr) return null;
      if (d.grid && d.gridFocus === focus) return d.grid;
      try {
        const g = await E.detectGrid(url, focus, tr.bpm || 0);
        if (d.track !== tr || !g) return null;
        d.grid = g.beats; d.gridFocus = focus;
        if (!tr.bpm) d.nbpm = g.bpm;
        return d.grid;
      } catch { return null; }
    },
    level(d) { // 0..1 RMS for the meters
      const buf = new Uint8Array(d.an.fftSize);
      d.an.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
      return Math.min(1, Math.sqrt(s / buf.length) * 2.2);
    },
  };
  E.setXf(0);
  // the audio thread sleeps while nothing plays (every HYPERSPACE window has an engine, most never use it)
  ctx.suspend().catch(() => {});
  let idleSince = 0;
  setInterval(() => {
    if (A.el.paused && B.el.paused) {
      if (!idleSince) idleSince = Date.now();
      else if (Date.now() - idleSince > 30000 && ctx.state === 'running') ctx.suspend().catch(() => {});
    } else idleSince = 0;
  }, 5000);
  for (const d of [A, B]) d.el.addEventListener('play', E.resume);
  return E;
})();
