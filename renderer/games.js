// GAMES: Blackjack, Poker (Texas Hold'em vs bots, Five-Card Draw vs bots, Jacks-or-Better video poker) and
// Spades (you + a bot partner vs two bots). One chip bank for the casino games, kept on this computer.
(() => {
  const root = $('#view-games');
  if (!root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get() { try { return JSON.parse(localStorage.getItem('hs-games')) || {}; } catch { return {}; } }, set(v) { try { localStorage.setItem('hs-games', JSON.stringify(v)); } catch {} } };
  const G = { chips: 1000, stats: {}, ...store.get() };
  const saveG = () => store.set(G);
  const stat = (k) => { G.stats[k] = (G.stats[k] || 0) + 1; saveG(); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------- cards ----------------
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RN = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const rname = (r) => RN[r] || String(r);
  const deck = (n = 1) => { const d = []; for (let k = 0; k < n; k++) for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s }); for (let i = d.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; } return d; };
  const red = (c) => c.s === '♥' || c.s === '♦';
  const card = (c, o = {}) => c && !o.down
    ? `<div class="gc ${red(c) ? 'red' : ''} ${o.cls || ''}" ${o.attr || ''}><b>${rname(c.r)}</b><i>${c.s}</i><em>${c.s}</em></div>`
    : `<div class="gc down ${o.cls || ''}"></div>`;

  // best 5-card poker hand out of 5-7 cards → [category, tiebreakers…] (higher array wins)
  const CAT = ['HIGH CARD', 'PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT', 'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH'];
  function eval5(cs) {
    const rs = cs.map((c) => c.r).sort((a, b) => b - a);
    const flush = cs.every((c) => c.s === cs[0].s);
    const u = [...new Set(rs)];
    let straight = 0;
    if (u.length === 5 && u[0] - u[4] === 4) straight = u[0];
    if (u.join() === '14,5,4,3,2') straight = 5;
    const cnt = {}; rs.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
    const groups = Object.entries(cnt).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const by = groups.map((g) => g[1]);
    if (straight && flush) return [8, straight];
    if (groups[0][0] === 4) return [7, ...by];
    if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...by];
    if (flush) return [5, ...rs];
    if (straight) return [4, straight];
    if (groups[0][0] === 3) return [3, ...by];
    if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...by];
    if (groups[0][0] === 2) return [1, ...by];
    return [0, ...rs];
  }
  const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); } return 0; };
  function best(cs) {
    if (cs.length <= 5) return eval5(cs);
    let top = null;
    const pick = (start, chosen) => { // every 5-card combination
      if (chosen.length === 5) { const e = eval5(chosen); if (!top || cmp(e, top) > 0) top = e; return; }
      for (let k = start; k <= cs.length - (5 - chosen.length); k++) pick(k + 1, [...chosen, cs[k]]);
    };
    pick(0, []);
    return top;
  }

  // ---------------- lobby ----------------
  window.GAMES = { open: (g) => open(g) };
  function lobby() {
    root.innerHTML = `<div class="gm-wrap"><div class="gm-head"><div><div class="gm-kicker">HYPERSPACE CASINO</div><h2>GAMES</h2></div>
      <div class="gm-bank"><span>CHIPS</span><b>${G.chips.toLocaleString()}</b>${G.chips < 100 ? '<button class="act" id="gm-refill">REFILL TO 1,000</button>' : ''}</div></div>
      <div class="gm-tiles">
        <button data-g="blackjack"><i>🂡</i><b>BLACKJACK</b><span>Beat the dealer to 21. Classic, Vegas, or Practice with strategy hints.</span></button>
        <button data-g="poker"><i>♠♥</i><b>POKER</b><span>Texas Hold'em or Five-Card Draw against three bots, or Jacks-or-Better video poker.</span></button>
        <button data-g="spades"><i>♠</i><b>SPADES</b><span>You and a bot partner against two bots. Bid, take tricks, watch your bags.</span></button>
      </div>
      <p class="gm-note">Play chips only: no real money, nothing online. Your chips are saved on this computer.</p></div>`;
    root.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => open(b.dataset.g)));
    $('#gm-refill')?.addEventListener('click', () => { G.chips = 1000; saveG(); lobby(); });
  }
  function frame(title, modes, mode, body) {
    return `<div class="gm-wrap"><div class="gm-head"><button class="act" id="gm-back">‹ GAMES</button><h2>${title}</h2>
      ${modes ? `<div class="seg small gm-modes">${modes.map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <span class="grow"></span><div class="gm-bank"><span>CHIPS</span><b id="gm-chips">${G.chips.toLocaleString()}</b></div></div>${body}</div>`;
  }
  function wireFrame(onMode) {
    $('#gm-back').addEventListener('click', lobby);
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => onMode(b.dataset.mode)));
  }
  const chipsEl = () => { const e = $('#gm-chips'); if (e) e.textContent = G.chips.toLocaleString(); };
  function open(g) { ({ blackjack: bj, poker: pk, spades: sp }[g] || lobby)(); }

  // ================= BLACKJACK =================
  const BJ = { mode: 'classic', shoe: [], bet: 0, lastBet: 25, hands: [], dealer: [], active: 0, phase: 'bet', msg: '' };
  const bjVal = (h) => { let t = 0, a = 0; for (const c of h) { t += c.r === 14 ? 11 : Math.min(10, c.r); if (c.r === 14) a++; } while (t > 21 && a) { t -= 10; a--; } return { t, soft: a > 0 }; };
  const bjDraw = () => { if (BJ.shoe.length < 60) BJ.shoe = deck(6); return BJ.shoe.pop(); };
  function hint(h, up) { // basic strategy, simplified
    const { t, soft } = bjVal(h.cards), u = Math.min(10, up.r === 14 ? 11 : up.r) || 11, two = h.cards.length === 2;
    if (two && h.cards[0].r === h.cards[1].r && BJ.hands.length === 1) { const r = h.cards[0].r; if (r === 14 || r === 8) return 'SPLIT'; if ([2, 3, 6, 7, 9].includes(r) && u <= 7 && u !== 1) return 'SPLIT'; }
    if (soft) { if (t >= 19) return 'STAND'; if (t === 18) return u >= 9 ? 'HIT' : u <= 6 && two ? 'DOUBLE' : 'STAND'; return u >= 4 && u <= 6 && two ? 'DOUBLE' : 'HIT'; }
    if (t >= 17) return 'STAND'; if (t >= 13) return u <= 6 ? 'STAND' : 'HIT'; if (t === 12) return u >= 4 && u <= 6 ? 'STAND' : 'HIT';
    if (t === 11) return two ? 'DOUBLE' : 'HIT'; if (t === 10) return u <= 9 && two ? 'DOUBLE' : 'HIT'; if (t === 9) return u >= 3 && u <= 6 && two ? 'DOUBLE' : 'HIT'; return 'HIT';
  }
  function bj() {
    const h = BJ.hands[BJ.active], play = BJ.phase === 'play';
    const handHtml = (hh, k) => `<div class="bj-hand ${play && k === BJ.active ? 'on' : ''}"><div class="gm-cards">${hh.cards.map((c) => card(c)).join('')}</div><span>${bjVal(hh.cards).t}${hh.result ? ` · ${hh.result}` : ''} · bet ${hh.bet}</span></div>`;
    root.innerHTML = frame('BLACKJACK', [['classic', 'CLASSIC'], ['vegas', 'VEGAS'], ['practice', 'PRACTICE']], BJ.mode, `
      <div class="gm-table bj">
        <div class="bj-row"><span class="gm-lbl">DEALER ${BJ.dealer.length && BJ.phase !== 'play' ? `· ${bjVal(BJ.dealer).t}` : ''}</span><div class="gm-cards">${BJ.dealer.map((c, k) => card(c, { down: k === 1 && BJ.phase === 'play' })).join('')}</div></div>
        <div class="gm-msg">${esc(BJ.msg)}</div>
        <div class="bj-row you"><span class="gm-lbl">YOU</span><div class="bj-hands">${BJ.hands.map(handHtml).join('')}</div></div>
        ${play && BJ.mode === 'practice' ? `<div class="gm-hint">STRATEGY SAYS: <b>${hint(h, BJ.dealer[0])}</b></div>` : ''}
        <div class="gm-actions">${BJ.phase === 'bet' ? `<span class="gm-bet">BET <b>${BJ.bet}</b></span>${[5, 25, 100, 500].map((v) => `<button class="chip-btn" data-add="${v}">+${v}</button>`).join('')}<button class="act" id="bj-clear">CLEAR</button><button class="gm-go" id="bj-deal" ${BJ.bet ? '' : 'disabled'}>DEAL</button>`
          : play ? `<button class="gm-go" data-a="hit">HIT</button><button class="gm-go" data-a="stand">STAND</button>${h.cards.length === 2 && G.chips >= h.bet ? '<button class="gm-go" data-a="double">DOUBLE</button>' : ''}${h.cards.length === 2 && h.cards[0].r === h.cards[1].r && BJ.hands.length === 1 && G.chips >= h.bet ? '<button class="gm-go" data-a="split">SPLIT</button>' : ''}`
          : `<button class="gm-go" id="bj-again">BET ${BJ.lastBet} AGAIN</button><button class="act" id="bj-new">CHANGE BET</button>`}</div>
        <p class="gm-rules">${BJ.mode === 'vegas' ? 'Vegas: dealer hits soft 17' : 'Dealer stands on all 17s'} · blackjack pays 3:2 · double on any two cards · one split</p>
      </div>`);
    wireFrame((m) => { BJ.mode = m; bj(); });
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { const v = +b.dataset.add; if (BJ.bet + v <= G.chips) { BJ.bet += v; bj(); } else toast('NOT ENOUGH CHIPS', true); }));
    $('#bj-clear')?.addEventListener('click', () => { BJ.bet = 0; bj(); });
    $('#bj-deal')?.addEventListener('click', bjDeal);
    $('#bj-again')?.addEventListener('click', () => { BJ.phase = 'bet'; BJ.bet = Math.min(BJ.lastBet, G.chips); if (BJ.bet) bjDeal(); else bj(); });
    $('#bj-new')?.addEventListener('click', () => { BJ.phase = 'bet'; BJ.hands = []; BJ.dealer = []; BJ.msg = ''; bj(); });
    root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => bjAct(b.dataset.a)));
  }
  function bjDeal() {
    if (!BJ.bet || BJ.bet > G.chips) return;
    G.chips -= BJ.bet; BJ.lastBet = BJ.bet; saveG();
    BJ.hands = [{ cards: [bjDraw(), bjDraw()], bet: BJ.bet }]; BJ.dealer = [bjDraw(), bjDraw()]; BJ.active = 0; BJ.phase = 'play'; BJ.msg = ''; BJ.bet = 0;
    const pb = bjVal(BJ.hands[0].cards).t === 21, db = bjVal(BJ.dealer).t === 21;
    if (pb || db) return bjSettle();
    bj();
  }
  function bjAct(a) {
    const h = BJ.hands[BJ.active];
    if (a === 'hit') { h.cards.push(bjDraw()); if (bjVal(h.cards).t >= 21) return bjNext(); }
    if (a === 'stand') return bjNext();
    if (a === 'double') { G.chips -= h.bet; h.bet *= 2; h.cards.push(bjDraw()); saveG(); return bjNext(); }
    if (a === 'split') { G.chips -= h.bet; saveG(); const c2 = h.cards.pop(); h.cards.push(bjDraw()); BJ.hands.push({ cards: [c2, bjDraw()], bet: h.bet }); }
    bj();
  }
  function bjNext() { if (BJ.active < BJ.hands.length - 1) { BJ.active++; bj(); } else bjSettle(); }
  async function bjSettle() {
    BJ.phase = 'dealer';
    const live = BJ.hands.some((h) => bjVal(h.cards).t <= 21);
    const natural = BJ.hands.length === 1 && BJ.hands[0].cards.length === 2 && bjVal(BJ.hands[0].cards).t === 21;
    if (live && !natural) while (true) { const v = bjVal(BJ.dealer); if (v.t > 17 || (v.t === 17 && !(BJ.mode === 'vegas' && v.soft))) break; BJ.dealer.push(bjDraw()); }
    const d = bjVal(BJ.dealer).t, dbj = d === 21 && BJ.dealer.length === 2;
    let net = 0;
    for (const h of BJ.hands) {
      const p = bjVal(h.cards).t, pbj = p === 21 && h.cards.length === 2 && BJ.hands.length === 1;
      let pay = 0;
      if (p > 21) h.result = 'BUST';
      else if (pbj && !dbj) { pay = h.bet * 2.5; h.result = 'BLACKJACK!'; }
      else if (dbj && !pbj) h.result = 'DEALER BLACKJACK';
      else if (d > 21 || p > d) { pay = h.bet * 2; h.result = 'WIN'; }
      else if (p === d) { pay = h.bet; h.result = 'PUSH'; }
      else h.result = 'LOSE';
      G.chips += Math.floor(pay); net += pay - h.bet;
    }
    BJ.msg = net > 0 ? `YOU WIN ${Math.floor(net)}` : net < 0 ? `YOU LOSE ${-net}` : 'PUSH: BET RETURNED';
    stat(net > 0 ? 'bjWin' : net < 0 ? 'bjLoss' : 'bjPush');
    BJ.phase = 'done'; saveG(); bj();
  }

  // ================= POKER =================
  const PK = { mode: 'holdem', st: null };
  const BOTS = ['NEO', 'TRINITY', 'MORPHEUS'];
  function pk() {
    if (PK.mode === 'video') return vp();
    if (!PK.st || PK.st.mode !== PK.mode) pkNewTable();
    pkRender();
  }
  function pkNewTable() {
    PK.st = { mode: PK.mode, players: [{ name: 'YOU', you: true, chips: 0 }, ...BOTS.map((n) => ({ name: n, chips: 1000 }))], dealer: 0, hand: 0, log: [], phase: 'idle' };
  }
  const bb = 20;
  async function pkStartHand() {
    const s = PK.st, buy = 500;
    const me = s.players[0];
    if (me.chips < bb) { if (G.chips < buy) return toast('NOT ENOUGH CHIPS: REFILL IN THE GAMES LOBBY', true); G.chips -= buy; me.chips += buy; saveG(); s.log.unshift(`You bought in for ${buy}.`); }
    s.players.forEach((p) => { if (!p.you && p.chips < bb) p.chips = 1000; Object.assign(p, { cards: [], bet: 0, folded: false, allin: false, acted: false }); });
    s.deck = deck(); s.board = []; s.pot = 0; s.hand++; s.dealer = (s.dealer + 1) % 4; s.phase = 'bet'; s.round = 0; s.result = null;
    const n = s.mode === 'holdem' ? 2 : 5;
    for (let k = 0; k < n; k++) s.players.forEach((p) => p.cards.push(s.deck.pop()));
    if (s.mode === 'holdem') { post((s.dealer + 1) % 4, bb / 2); post((s.dealer + 2) % 4, bb); s.toAct = (s.dealer + 3) % 4; s.high = bb; }
    else { s.players.forEach((_, k) => post(k, 5)); s.players.forEach((p) => { p.bet = 0; }); s.toAct = (s.dealer + 1) % 4; s.high = 0; }
    s.raises = 0;
    pkLoop();
  }
  function post(k, amt) { const p = PK.st.players[k]; const a = Math.min(amt, p.chips); p.chips -= a; p.bet += a; PK.st.pot += a; if (!p.chips) p.allin = true; }
  const live = () => PK.st.players.filter((p) => !p.folded);
  const betSize = () => (PK.st.mode === 'holdem' ? (PK.st.round >= 2 ? bb * 2 : bb) : (PK.st.round >= 1 ? 40 : 20));
  function strength(p) { // 0..1 rough hand strength for the bots
    const s = PK.st, cs = [...p.cards, ...(s.board || [])];
    if (s.mode === 'holdem' && s.board.length === 0) {
      const [a, b] = p.cards.map((c) => c.r).sort((x, y) => y - x);
      let v = (a + b) / 28 * 0.6 + (a === b ? 0.3 + a / 50 : 0) + (p.cards[0].s === p.cards[1].s ? 0.05 : 0) + (a - b === 1 ? 0.03 : 0);
      return Math.min(1, v);
    }
    const e = best(cs);
    return Math.min(1, e[0] / 6 + (e[1] || 0) / 70 + 0.05);
  }
  async function pkLoop() {
    const s = PK.st;
    while (s.phase === 'bet') {
      if (live().length === 1) return pkShowdown();
      const actors = s.players.filter((p) => !p.folded && !p.allin);
      const settled = actors.every((p) => p.acted && p.bet === s.high);
      if (settled || actors.length === 0 || (actors.length === 1 && actors[0].bet >= s.high)) { await pkNextRound(); continue; }
      const p = s.players[s.toAct];
      if (p.folded || p.allin) { s.toAct = (s.toAct + 1) % 4; continue; }
      if (p.you) { pkRender(); return; } // wait for the buttons
      pkRender(); await wait(550);
      const f = strength(p) + (Math.random() - 0.5) * 0.18, owe = s.high - p.bet;
      if (owe > 0 && f < 0.32 && !(owe <= bb / 2 && f > 0.2)) pkDo(p, 'fold');
      else if (f > 0.72 && s.raises < 3 && p.chips > owe + betSize()) pkDo(p, 'raise');
      else pkDo(p, 'call');
    }
  }
  function pkDo(p, a) {
    const s = PK.st, owe = s.high - p.bet;
    if (a === 'fold') { p.folded = true; s.log.unshift(`${p.name} folds.`); }
    else if (a === 'call') { const amt = Math.min(owe, p.chips); p.chips -= amt; p.bet += amt; s.pot += amt; if (!p.chips) p.allin = true; s.log.unshift(owe ? `${p.name} calls ${amt}.` : `${p.name} checks.`); }
    else if (a === 'raise') {
      const amt = Math.min(owe + betSize(), p.chips); p.chips -= amt; p.bet += amt; s.pot += amt; if (!p.chips) p.allin = true;
      s.high = Math.max(s.high, p.bet); s.raises++; s.players.forEach((q) => { if (q !== p) q.acted = false; });
      s.log.unshift(`${p.name} ${owe ? 'raises' : 'bets'} to ${p.bet}.`);
    }
    p.acted = true;
    s.toAct = (s.players.indexOf(p) + 1) % 4;
  }
  async function pkNextRound() {
    const s = PK.st;
    s.players.forEach((p) => { p.bet = 0; p.acted = false; });
    s.high = 0; s.raises = 0; s.round++;
    if (s.mode === 'holdem') {
      if (s.round === 1) s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop());
      else if (s.round <= 3) s.board.push(s.deck.pop());
      else return pkShowdown();
    } else {
      if (s.round === 1) { s.phase = 'draw'; pkBotsDraw(); pkRender(); return new Promise(() => {}); } // waits for YOUR draw
      if (s.round >= 2) return pkShowdown();
    }
    s.toAct = (s.dealer + 1) % 4;
    pkRender(); await wait(450);
  }
  function pkBotsDraw() {
    for (const p of PK.st.players) {
      if (p.you || p.folded) continue;
      const cnt = {}; p.cards.forEach((c) => { cnt[c.r] = (cnt[c.r] || 0) + 1; });
      const keep = best(p.cards)[0] >= 4 ? p.cards : p.cards.filter((c) => cnt[c.r] > 1 || (Object.values(cnt).every((n) => n === 1) && c.r >= 13));
      const n = Math.min(3, 5 - keep.length);
      p.cards = [...keep.slice(0, 5 - n), ...Array.from({ length: n }, () => PK.st.deck.pop())];
      p.drew = n;
      PK.st.log.unshift(`${p.name} draws ${n}.`);
    }
  }
  function pkShowdown() {
    const s = PK.st, alive = live();
    let winners;
    if (alive.length === 1) winners = alive;
    else {
      alive.forEach((p) => { p.best = best([...p.cards, ...(s.board || [])]); });
      const top = alive.reduce((a, p) => (cmp(p.best, a) > 0 ? p.best : a), alive[0].best);
      winners = alive.filter((p) => cmp(p.best, top) === 0);
    }
    const share = Math.floor(s.pot / winners.length);
    winners.forEach((w) => { w.chips += share; });
    s.result = `${winners.map((w) => w.name).join(' & ')} win${winners.length > 1 || winners[0].you ? '' : 's'} ${s.pot}${winners[0].best ? ` with ${CAT[winners[0].best[0]]}` : ''}`;
    s.log.unshift(s.result + '.');
    s.phase = 'done';
    stat(winners.some((w) => w.you) ? 'pkWin' : 'pkLoss');
    pkRender();
  }
  function pkRender() {
    const s = PK.st, me = s.players[0], myTurn = s.phase === 'bet' && s.toAct === 0 && !me.folded && !me.allin, owe = s.high - me.bet;
    const seat = (p, k) => `<div class="pk-seat s${k} ${s.phase !== 'idle' && s.toAct === k && s.phase === 'bet' ? 'turn' : ''} ${p.folded ? 'out' : ''}">
      <b>${esc(p.name)}${s.dealer === k ? ' <em>D</em>' : ''}</b><span>${p.chips} chips${p.bet ? ` · bet ${p.bet}` : ''}${p.folded ? ' · folded' : p.allin ? ' · ALL-IN' : ''}</span>
      <div class="gm-cards ${p.you ? '' : 'small'}">${(p.cards || []).map((c, ci) => card(c, { down: !p.you && s.phase !== 'done', cls: p.you && s.phase === 'draw' && s.discard?.has(ci) ? 'pick' : '', attr: p.you && s.phase === 'draw' ? `data-dc="${ci}"` : '' })).join('')}</div>
      ${p.best && s.phase === 'done' && !p.folded ? `<span class="pk-hand">${CAT[p.best[0]]}</span>` : ''}</div>`;
    root.innerHTML = frame('POKER', [['holdem', "TEXAS HOLD'EM"], ['draw', 'FIVE-CARD DRAW'], ['video', 'VIDEO POKER']], PK.mode, `
      <div class="gm-table pk">
        <div class="pk-ring">${s.players.map(seat).join('')}
          <div class="pk-mid"><div class="gm-cards">${(s.board || []).map((c) => card(c)).join('')}</div><div class="pk-pot">POT <b>${s.pot || 0}</b></div><div class="gm-msg">${esc(s.result || (s.phase === 'draw' ? 'Click the cards you want to swap (up to 3), then DRAW.' : ''))}</div></div>
        </div>
        <div class="gm-actions">${s.phase === 'idle' || s.phase === 'done' ? `<button class="gm-go" id="pk-deal">DEAL ${s.hand ? 'NEXT HAND' : ''}</button><span class="gm-note">${me.chips ? `${me.chips} chips on the table` : 'You buy in for 500 chips'} · ${s.mode === 'holdem' ? 'blinds 10/20, fixed-limit' : 'ante 5, bets 20 / 40'}</span>${me.chips ? '<button class="act" id="pk-cash">CASH OUT</button>' : ''}`
          : s.phase === 'draw' ? `<button class="gm-go" id="pk-draw">DRAW ${s.discard?.size || 0}</button>`
          : myTurn ? `<button class="gm-go" data-pa="fold">FOLD</button><button class="gm-go" data-pa="call">${owe ? `CALL ${Math.min(owe, me.chips)}` : 'CHECK'}</button>${s.raises < 3 && me.chips > owe ? `<button class="gm-go" data-pa="raise">${owe ? 'RAISE' : 'BET'} ${betSize()}</button>` : ''}`
          : '<span class="gm-note">bots thinking…</span>'}</div>
        <div class="pk-log">${s.log.slice(0, 6).map(esc).join('<br>')}</div>
      </div>`);
    wireFrame((m) => { PK.mode = m; pk(); });
    $('#pk-deal')?.addEventListener('click', pkStartHand);
    $('#pk-cash')?.addEventListener('click', () => { G.chips += me.chips; me.chips = 0; saveG(); toast('CHIPS BACK IN YOUR BANK'); pkRender(); });
    root.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', () => { pkDo(me, b.dataset.pa); pkLoop(); }));
    root.querySelectorAll('[data-dc]').forEach((c) => c.addEventListener('click', () => { s.discard ||= new Set(); const k = +c.dataset.dc; if (s.discard.has(k)) s.discard.delete(k); else if (s.discard.size < 3) s.discard.add(k); pkRender(); }));
    $('#pk-draw')?.addEventListener('click', () => {
      const d = s.discard || new Set();
      me.cards = me.cards.map((c, k) => (d.has(k) ? s.deck.pop() : c));
      s.log.unshift(`You draw ${d.size}.`); s.discard = null; s.phase = 'bet'; s.toAct = (s.dealer + 1) % 4; pkLoop();
    });
  }

  // ---------------- video poker: Jacks or Better (9/6) ----------------
  const VP = { bet: 5, hand: [], hold: new Set(), phase: 'bet', deck: null, msg: '' };
  const PAY = [['ROYAL FLUSH', 800], ['STRAIGHT FLUSH', 50], ['FOUR OF A KIND', 25], ['FULL HOUSE', 9], ['FLUSH', 6], ['STRAIGHT', 4], ['THREE OF A KIND', 3], ['TWO PAIR', 2], ['JACKS OR BETTER', 1]];
  function vpScore(h) {
    const e = eval5(h);
    if (e[0] === 8) return e[1] === 14 ? 'ROYAL FLUSH' : 'STRAIGHT FLUSH';
    if (e[0] === 1) return e[1] >= 11 ? 'JACKS OR BETTER' : null;
    return e[0] ? CAT[e[0]] : null;
  }
  function vp() {
    root.innerHTML = frame('POKER', [['holdem', "TEXAS HOLD'EM"], ['draw', 'FIVE-CARD DRAW'], ['video', 'VIDEO POKER']], 'video', `
      <div class="gm-table vp">
        <div class="vp-pay">${PAY.map(([n, x]) => `<div class="${VP.msg.startsWith(n) ? 'hit' : ''}"><span>${n}</span><b>${x * VP.bet}</b></div>`).join('')}</div>
        <div class="gm-cards big">${(VP.hand.length ? VP.hand : Array(5).fill(null)).map((c, k) => `<div class="vp-slot" data-h="${k}">${card(c, { down: !c })}<span>${VP.hold.has(k) ? 'HELD' : '&nbsp;'}</span></div>`).join('')}</div>
        <div class="gm-msg">${esc(VP.msg || (VP.phase === 'draw' ? 'Click the cards to HOLD, then DRAW.' : 'Jacks or Better · 9/6 pay table'))}</div>
        <div class="gm-actions">${VP.phase === 'draw' ? '<button class="gm-go" id="vp-go">DRAW</button>' : `<span class="gm-bet">BET <b>${VP.bet}</b></span>${[1, 5, 25].map((v) => `<button class="chip-btn" data-vb="${v}">${v}</button>`).join('')}<button class="gm-go" id="vp-go">DEAL</button>`}</div>
      </div>`);
    wireFrame((m) => { PK.mode = m; pk(); });
    root.querySelectorAll('[data-vb]').forEach((b) => b.addEventListener('click', () => { VP.bet = +b.dataset.vb; vp(); }));
    root.querySelectorAll('[data-h]').forEach((el) => el.addEventListener('click', () => { if (VP.phase !== 'draw') return; const k = +el.dataset.h; VP.hold.has(k) ? VP.hold.delete(k) : VP.hold.add(k); vp(); }));
    $('#vp-go').addEventListener('click', () => {
      if (VP.phase !== 'draw') {
        if (G.chips < VP.bet) return toast('NOT ENOUGH CHIPS', true);
        G.chips -= VP.bet; saveG(); VP.deck = deck(); VP.hand = Array.from({ length: 5 }, () => VP.deck.pop()); VP.hold = new Set(); VP.phase = 'draw'; VP.msg = '';
      } else {
        VP.hand = VP.hand.map((c, k) => (VP.hold.has(k) ? c : VP.deck.pop()));
        const w = vpScore(VP.hand), pay = w ? PAY.find((p) => p[0] === w)[1] * VP.bet : 0;
        G.chips += pay; saveG(); VP.phase = 'bet'; VP.hold = new Set();
        VP.msg = w ? `${w} · WIN ${pay}` : 'NO WIN';
        stat(pay ? 'vpWin' : 'vpLoss');
      }
      vp();
    });
  }

  // ================= SPADES =================
  // seats: 0 = you (south), 1 = west bot, 2 = your partner (north), 3 = east bot. Team 0 = seats 0 & 2.
  const SP = { mode: 'classic', st: null, opp: G.spOpp || 'normal', partner: G.spPartner || 'normal' };
  const LV = ['easy', 'normal', 'hard'];
  const lvOf = (seat) => (seat === 2 ? SP.partner : SP.opp);
  const SPN = ['YOU', 'GHOST', 'PARTNER', 'CIPHER'];
  const spTarget = () => (SP.mode === 'quick' ? 200 : 500);
  function sp() { if (!SP.st) spNewGame(); spRender(); }
  function spNewGame() { SP.st = { score: [0, 0], bags: [0, 0], dealer: 3, round: 0, phase: 'idle', log: [] }; }
  function spDeal() {
    const s = SP.st, d = deck();
    s.hands = [[], [], [], []]; d.forEach((c, k) => s.hands[k % 4].push(c));
    const order = (c) => SUITS.indexOf(c.s) * 20 + (20 - c.r);
    s.hands.forEach((h) => h.sort((a, b) => order(a) - order(b)));
    s.bids = [null, null, null, null]; s.tricks = [0, 0, 0, 0]; s.trick = []; s.broken = false; s.round++; s.played = [];
    s.dealer = (s.dealer + 1) % 4; s.turn = (s.dealer + 1) % 4; s.phase = 'bid'; s.lead = s.turn;
    spBotBids();
  }
  function botBid(h, lv = 'normal') {
    let t = 0;
    const by = (s) => h.filter((c) => c.s === s);
    for (const s of ['♥', '♦', '♣']) { const cs = by(s); if (cs.some((c) => c.r === 14)) t += 1; if (cs.some((c) => c.r === 13) && cs.length >= 2 && cs.length <= 4) t += 0.8; if (cs.length <= 1) t += 0.5; }
    const sp = by('♠'); t += sp.filter((c) => c.r >= 12).length + Math.max(0, sp.length - 3) * 0.7;
    let b = Math.round(t);
    if (lv === 'easy') b = Math.max(1, b + Math.round((Math.random() - 0.5) * 3)); // sloppy guesses
    if (lv === 'hard') b = Math.round(t - 0.2); // a touch careful: bags cost
    return b === 0 && SP.mode !== 'nonil' && !sp.some((c) => c.r >= 11) ? 0 : Math.max(1, Math.min(13, b));
  }
  async function spBotBids() {
    const s = SP.st;
    while (s.phase === 'bid') {
      if (s.bids.every((b) => b !== null)) { s.phase = 'play'; s.turn = (s.dealer + 1) % 4; break; }
      if (s.turn === 0) { spRender(); return; }
      spRender(); await wait(400);
      s.bids[s.turn] = botBid(s.hands[s.turn], lvOf(s.turn));
      s.log.unshift(`${SPN[s.turn]} bids ${s.bids[s.turn] === 0 ? 'NIL' : s.bids[s.turn]}.`);
      s.turn = (s.turn + 1) % 4;
    }
    spLoop();
  }
  function legal(h, trick, broken) {
    if (!trick.length) { const non = h.filter((c) => c.s !== '♠'); return broken || !non.length ? h : non; }
    const suit = trick[0].c.s, follow = h.filter((c) => c.s === suit);
    return follow.length ? follow : h;
  }
  function winnerOf(trick) {
    const suit = trick[0].c.s;
    return trick.reduce((w, t) => {
      const a = w.c, b = t.c;
      if (b.s === a.s && b.r > a.r) return t;
      if (b.s === '♠' && a.s !== '♠') return t;
      return w;
    }, trick[0]);
  }
  function botPlay(seat) {
    const s = SP.st, h = s.hands[seat], ok = legal(h, s.trick, s.broken), low = (cs) => cs.reduce((a, c) => (c.r < a.r ? c : a)), high = (cs) => cs.reduce((a, c) => (c.r > a.r ? c : a));
    const nil = s.bids[seat] === 0, lv = lvOf(seat);
    if (lv === 'easy' && !nil) return ok[(Math.random() * ok.length) | 0]; // plays any legal card
    if (!s.trick.length) {
      if (nil) return low(ok);
      if (lv === 'hard') { // lead a card nobody can beat: the highest one left in its suit
        const out = (c) => s.played.some((p) => p.s === c.s && p.r === c.r);
        const boss = ok.filter((c) => c.s !== '♠' && Array.from({ length: 14 - c.r }, (_, k) => ({ s: c.s, r: c.r + k + 1 })).every((x) => out(x) || h.some((y) => y.s === x.s && y.r === x.r)));
        if (boss.length) return high(boss);
      }
      const aces = ok.filter((c) => c.s !== '♠' && c.r === 14); if (aces.length) return aces[0];
      const nonS = ok.filter((c) => c.s !== '♠'); return low(nonS.length ? nonS : ok);
    }
    const w = winnerOf(s.trick), partnerWinning = w.seat === (seat + 2) % 4;
    const beats = ok.filter((c) => winnerOf([...s.trick, { seat, c }]).seat === seat);
    if (nil) { const under = ok.filter((c) => !beats.includes(c)); return under.length ? high(under) : low(ok); }
    if (partnerWinning || !beats.length) { const off = ok.filter((c) => c.s !== '♠'); return low(off.length ? off : ok); }
    return low(beats);
  }
  async function spLoop() {
    const s = SP.st;
    while (s.phase === 'play') {
      if (s.trick.length === 4) {
        const w = winnerOf(s.trick); s.tricks[w.seat]++; s.log.unshift(`${SPN[w.seat]} takes the trick.`);
        spRender(); await wait(900); s.trick = []; s.turn = w.seat;
        if (s.hands.every((h) => !h.length)) return spScore();
      }
      if (s.turn === 0) { spRender(); return; }
      spRender(); await wait(500);
      spPlay(s.turn, botPlay(s.turn));
    }
  }
  function spPlay(seat, c) {
    const s = SP.st;
    s.hands[seat] = s.hands[seat].filter((x) => x !== c);
    if (c.s === '♠') s.broken = true;
    s.trick.push({ seat, c }); s.played.push(c);
    s.turn = (seat + 1) % 4;
  }
  function spScore() {
    const s = SP.st, lines = [];
    for (const team of [0, 1]) {
      const seats = [team, team + 2];
      let pts = 0, bid = 0, took = 0;
      for (const k of seats) {
        if (s.bids[k] === 0) { const ok = s.tricks[k] === 0; pts += ok ? 100 : -100; lines.push(`${SPN[k]} ${ok ? 'made' : 'broke'} NIL (${ok ? '+' : '-'}100)`); }
        else { bid += s.bids[k]; took += s.tricks[k]; }
      }
      if (bid) {
        if (took >= bid) { const over = took - bid; pts += bid * 10 + over; s.bags[team] += over; }
        else pts -= bid * 10;
        if (s.bags[team] >= 10) { s.bags[team] -= 10; pts -= 100; lines.push(`${team ? 'They' : 'You'} hit 10 bags (-100)`); }
      }
      s.score[team] += pts;
      lines.push(`${team ? 'THEM' : 'US'}: bid ${bid}, took ${took} → ${pts >= 0 ? '+' : ''}${pts}`);
    }
    s.summary = lines;
    // partner report card for this round: made their bid = helped, missed it (or broke nil) = hurt, exact = drew level
    const ps = (G.spStats ||= { opp: {}, partner: {} });
    const pr = (ps.partner[SP.partner] ||= { helped: 0, hurt: 0, even: 0, won: 0, lost: 0 });
    const pb = s.bids[2], pt = s.tricks[2];
    if (pb === 0 ? pt === 0 : pt > pb) pr.helped++; else if (pb === 0 ? pt > 0 : pt < pb) pr.hurt++; else pr.even++;
    const t = spTarget();
    if (s.score[0] >= t || s.score[1] >= t || s.score[0] <= -t || s.score[1] <= -t) {
      s.phase = 'over'; s.winner = s.score[0] >= s.score[1] ? 0 : 1; stat(s.winner === 0 ? 'spWin' : 'spLoss');
      const op = (ps.opp[SP.opp] ||= { beatYou: 0, youBeat: 0 });
      if (s.winner === 0) { op.youBeat++; pr.won++; } else { op.beatYou++; pr.lost++; }
    } else s.phase = 'scored';
    saveG();
    spRender();
  }
  function spRender() {
    const s = SP.st, me = s.hands?.[0] || [], ok = s.phase === 'play' && s.turn === 0 ? legal(me, s.trick, s.broken) : [];
    const pos = ['south', 'west', 'north', 'east'];
    const seat = (k) => `<div class="sp-seat ${pos[k]} ${s.turn === k && ['bid', 'play'].includes(s.phase) ? 'turn' : ''}"><b>${SPN[k]}</b><span>bid ${s.bids?.[k] === null || s.bids?.[k] === undefined ? '…' : s.bids[k] === 0 ? 'NIL' : s.bids[k]} · took ${s.tricks?.[k] ?? 0}</span>${k ? `<div class="sp-back">${(s.hands?.[k] || []).map(() => '<i></i>').join('')}</div>` : ''}</div>`;
    root.innerHTML = frame('SPADES', [['classic', 'PARTNERS TO 500'], ['quick', 'QUICK TO 200'], ['nonil', 'NO NIL BIDS']], SP.mode, `
      <div class="gm-table sp">
        <div class="sp-levels"><span>OPPONENTS</span><div class="seg small">${LV.map((l) => `<button data-opp="${l}" class="${SP.opp === l ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
          <span>PARTNER</span><div class="seg small">${LV.map((l) => `<button data-par="${l}" class="${SP.partner === l ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
          <button class="act" id="sp-stats">RECORD</button></div>
        <div class="sp-score"><div><span>US</span><b>${s.score[0]}</b><em>${s.bags[0]} bags</em></div><div><span>THEM</span><b>${s.score[1]}</b><em>${s.bags[1]} bags</em></div><div class="dim">first to ${spTarget()} · round ${s.round}</div></div>
        <div class="sp-table">${[1, 2, 3].map(seat).join('')}
          <div class="sp-trick">${(s.trick || []).map((t) => `<div class="sp-t ${pos[t.seat]}">${card(t.c)}</div>`).join('')}</div></div>
        ${seat(0)}
        <div class="gm-cards sp-hand">${me.map((c, k) => card(c, { cls: ok.includes(c) ? 'play' : s.phase === 'play' && s.turn === 0 ? 'dim' : '', attr: ok.includes(c) ? `data-pc="${k}"` : '' })).join('')}</div>
        <div class="gm-actions">${s.phase === 'idle' ? '<button class="gm-go" id="sp-deal">DEAL</button>'
          : s.phase === 'bid' && s.turn === 0 ? `<span class="gm-note">Your bid: how many tricks will you take?</span><div class="sp-bids">${(SP.mode === 'nonil' ? [] : [0]).concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).map((b) => `<button class="chip-btn" data-bid="${b}">${b === 0 ? 'NIL' : b}</button>`).join('')}</div><span class="gm-note">partner bid ${s.bids[2] ?? '…'}</span>`
          : s.phase === 'scored' ? `<div class="sp-sum">${s.summary.map(esc).join('<br>')}</div><button class="gm-go" id="sp-deal">NEXT ROUND</button>`
          : s.phase === 'over' ? `<div class="sp-sum"><b>${s.winner === 0 ? 'YOU WIN THE GAME!' : 'THEY WIN THIS ONE.'}</b><br>${s.summary.map(esc).join('<br>')}</div><button class="gm-go" id="sp-new">NEW GAME</button>`
          : `<span class="gm-note">${s.phase === 'play' && s.turn === 0 ? `Your turn${s.trick.length ? '' : ': lead a card'}${!s.broken ? ' (spades not broken yet)' : ''}` : 'bots playing…'}</span>`}</div>
        <div class="pk-log">${(s.log || []).slice(0, 4).map(esc).join('<br>')}</div>
      </div>`);
    wireFrame((m) => { SP.mode = m; spNewGame(); spRender(); });
    $('#sp-deal')?.addEventListener('click', spDeal);
    const setLv = (k, v) => { SP[k] = v; G[k === 'opp' ? 'spOpp' : 'spPartner'] = v; saveG(); spRender(); };
    root.querySelectorAll('[data-opp]').forEach((b) => b.addEventListener('click', () => setLv('opp', b.dataset.opp)));
    root.querySelectorAll('[data-par]').forEach((b) => b.addEventListener('click', () => setLv('partner', b.dataset.par)));
    $('#sp-stats')?.addEventListener('click', () => {
      const st = G.spStats || { opp: {}, partner: {} };
      const rows = LV.map((l) => { const o = st.opp[l] || {}, p = st.partner[l] || {}; return `<tr><td>${l.toUpperCase()}</td><td>${o.beatYou || 0}</td><td>${o.youBeat || 0}</td><td>${p.helped || 0}</td><td>${p.hurt || 0}</td><td>${p.even || 0}</td><td>${p.won || 0}–${p.lost || 0}</td></tr>`; }).join('');
      const box = root.querySelector('.sp-sum-box') || Object.assign(document.createElement('div'), { className: 'sp-sum-box' });
      box.innerHTML = `<table class="sp-rec"><tr><th>LEVEL</th><th>OPPONENTS BEAT YOU</th><th>YOU BEAT THEM</th><th>PARTNER HELPED</th><th>PARTNER HURT</th><th>EVEN</th><th>GAMES W–L WITH THIS PARTNER</th></tr>${rows}</table><p class="gm-note">Partner, per round: made their bid with tricks to spare = helped, missed it (or broke nil) = hurt, exactly on their bid = even.</p>`;
      root.querySelector('.gm-table').appendChild(box);
    });
    $('#sp-new')?.addEventListener('click', () => { spNewGame(); spRender(); });
    root.querySelectorAll('[data-bid]').forEach((b) => b.addEventListener('click', () => { s.bids[0] = +b.dataset.bid; s.log.unshift(`You bid ${s.bids[0] === 0 ? 'NIL' : s.bids[0]}.`); s.turn = 1; spBotBids(); }));
    root.querySelectorAll('[data-pc]').forEach((el) => el.addEventListener('click', () => { spPlay(0, me[+el.dataset.pc]); spLoop(); }));
  }

  HS.viewListeners.push((v) => { if (v === 'games' && !root.innerHTML.trim()) lobby(); });
  lobby();
})();
