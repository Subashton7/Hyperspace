// Updates: HYPERSPACE looks at its GitHub Releases page, tells you when a newer version is there, and installs it
// when you click UPDATE. Nothing downloads or installs without that click. Only works in the installed app.
const { app } = require('electron');
const EventEmitter = require('events');

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle', current: app.getVersion(), latest: null, percent: 0, error: null, checkedAt: 0 };
    this.au = null;
  }
  get available() { return app.isPackaged; }
  set(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }
  start() {
    if (!this.available) return;
    try {
      const { autoUpdater } = require('electron-updater');
      this.au = autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.on('update-available', (i) => this.set({ status: 'available', latest: i.version, error: null, checkedAt: Date.now() }));
      autoUpdater.on('update-not-available', () => this.set({ status: 'current', latest: null, error: null, checkedAt: Date.now() }));
      autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', () => this.set({ status: 'ready', percent: 100 }));
      autoUpdater.on('error', (e) => this.set({ status: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200), checkedAt: Date.now() }));
      setTimeout(() => this.check().catch(() => {}), 45000); // not while the app is busy starting
      setInterval(() => { if (['idle', 'current', 'error'].includes(this.state.status)) this.check().catch(() => {}); }, 6 * 3600 * 1000);
    } catch (e) { this.set({ status: 'error', error: e.message }); }
  }
  async check() {
    if (!this.au) throw new Error('updates only work in the installed HYPERSPACE');
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', error: null });
    await this.au.checkForUpdates().catch((e) => this.set({ status: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200), checkedAt: Date.now() }));
    return this.state;
  }
  // click UPDATE: download it, then restart into the new version
  async install() {
    if (!this.au) throw new Error('updates only work in the installed HYPERSPACE');
    if (this.state.status === 'available') { this.set({ status: 'downloading', percent: 0 }); await this.au.downloadUpdate(); }
    if (this.state.status === 'ready') setTimeout(() => this.au.quitAndInstall(true, true), 400);
    return this.state;
  }
}
module.exports = { Updater };
