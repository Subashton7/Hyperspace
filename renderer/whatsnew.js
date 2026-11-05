// WHAT'S NEW: shown once after an update (localStorage 'hs-last-version'); reopened from SETTINGS > ABOUT.
(() => {
  if (hs.remote) return;
  const LOG = [
    { v: '0.16.0', items: [
      'Drag the sidebar buttons to put them in your own order.',
      'NOTES: only the Journal section is locked now. The rest of your notebook opens freely.',
      'QUICK NOTE and TO-DO now live in the side dock, and you can drag the modules around.',
      'To-do lists got categories and due dates.',
      'The De-Big-Tech quest and the casino moved into Settings.',
      'A little something is hiding in the app. Poke around.',
      'VJ now lives inside CRATE.',
      'A hidden toy for the keyboard wizards. Try some key combos.',
      'A brand new intro.',
      'DECK: save SCENES (volume, output, mute) and recall them with one click or a number key.',
      'Backup health card in Settings > General.',
      'New installs get a few short tips in the first two days. Replay them any time: Settings > ABOUT > TIPS TUTORIAL.',
    ] },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function show(ver) {
    if (document.querySelector('.wn-modal')) return;
    const e = LOG.find((x) => x.v === ver) || LOG[0];
    const m = document.createElement('div');
    m.className = 'wn-modal';
    m.innerHTML = `<div class="wn-box"><h2>WHAT'S NEW</h2><div class="wn-v">HYPERSPACE ${esc(ver || e.v)}</div><ul>${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><button class="act" id="wn-ok">GOT IT</button></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#wn-ok').addEventListener('click', close);
    m.addEventListener('mousedown', (ev) => { if (ev.target === m) close(); });
  }
  window.HS_WHATSNEW = show;
  (async () => {
    let ver = ''; try { ver = (await call('appInfo')).version; } catch {}
    if (!ver) return;
    let last = null; try { last = localStorage.getItem('hs-last-version'); } catch {}
    try { localStorage.setItem('hs-last-version', ver); } catch {}
    if (last && last !== ver && !HS.solo) setTimeout(() => show(ver), 6000);
  })();
})();
