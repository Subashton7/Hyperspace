const { contextBridge, ipcRenderer } = require('electron');

// Same surface as renderer/remote.js (the phone version), so app code doesn't care where it runs.
const listeners = {};
ipcRenderer.on('ev', (_e, ev, data) => (listeners[ev] || []).forEach((fn) => fn(data)));

contextBridge.exposeInMainWorld('hs', {
  remote: false,
  addons: ipcRenderer.sendSync('addons'),
  uiState: (() => { try { return ipcRenderer.sendSync('uistate-get'); } catch { return {}; } })(),
  uiStateSet: (key, val) => ipcRenderer.send('uistate-set', key, val),
  call: (name, ...args) => ipcRenderer.invoke('api', name, args),
  on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  win: (action) => ipcRenderer.send('win', action),
});
