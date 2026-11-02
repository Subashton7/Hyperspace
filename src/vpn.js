// VPN status, read locally (no web lookups): a VPN is "on" when its tunnel adapter is up with an address.
// Adapter names come from os.networkInterfaces() every few seconds (instant, no shell); their descriptions
// (to tell Proton from ExpressVPN from plain WireGuard) and which VPN apps are running are refreshed now and
// then from HyperCore (instant), or Get-NetAdapter / tasklist when the core isn't running.
const os = require('os');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const TUNNEL = /vpn|proton|protun|express|lightway|wireguard|wintun|nordlynx|mullvad|tailscale|openvpn|tap-windows|\btun\b|\btap\b/i;
const PROVIDERS = [
  [/proton|protun/i, 'Proton VPN'], [/express|lightway/i, 'ExpressVPN'], [/nord/i, 'NordVPN'], [/mullvad/i, 'Mullvad'],
  [/tailscale/i, 'Tailscale'], [/wireguard|wintun/i, 'WireGuard'], [/openvpn|tap/i, 'OpenVPN'],
];
const APPS = { 'protonvpn.client.exe': 'Proton VPN', 'protonvpn.exe': 'Proton VPN', 'expressvpn.exe': 'ExpressVPN', 'expressvpn.client.exe': 'ExpressVPN', 'nordvpn.exe': 'NordVPN', 'mullvad vpn.exe': 'Mullvad' };

class Vpn extends EventEmitter {
  // fast: optional { adapters() -> [{ name, desc }] | null, names() -> ['app.exe', …] | null } (HyperCore)
  constructor(fast = {}) {
    super();
    this.fast = fast;
    this.desc = {};   // adapter name -> description
    this.apps = [];   // VPN apps running
    this.state = { on: false, provider: null, adapter: null, ip: null, since: null, apps: [] };
    this.lastSlow = 0;
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), 3000);
  }

  ps(cmd) {
    return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 8000 }, (e, out) => res(String(out || ''))));
  }

  async slow() {
    this.lastSlow = Date.now();
    const d = {};
    const fast = await this.fast.adapters?.().catch(() => null);
    if (fast) for (const a of fast) d[a.name] = a.desc || '';
    else {
      const out = await this.ps('Get-NetAdapter -IncludeHidden | ForEach-Object { $_.Name + "`t" + $_.InterfaceDescription }');
      for (const line of out.split(/\r?\n/)) { const [n, ...rest] = line.split('\t'); if (n) d[n.trim()] = rest.join(' ').trim(); }
    }
    // names Get-NetAdapter doesn't list (loopback…) are remembered too, so they don't trigger another slow look
    for (const n of Object.keys(os.networkInterfaces())) if (!(n in d)) d[n] = '';
    if (Object.keys(d).length) this.desc = d;
    let names = await this.fast.names?.().catch(() => null);
    if (names) names = new Set(names);
    else {
      const list = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (e, o) => res(String(o || ''))));
      names = new Set(list.split(/\r?\n/).map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()));
    }
    this.apps = [...new Set(Object.entries(APPS).filter(([exe]) => names.has(exe)).map(([, p]) => p))];
  }

  async poll() {
    try {
      const ifs = os.networkInterfaces();
      const named = Object.keys(ifs);
      // descriptions are refreshed every 30 s, or when an adapter we don't know appears. Get-NetAdapter can take
      // ~10 s, so that runs in the background: the adapter name alone (ProTUN, WireGuard…) already says "on"
      if (!this.slowing && (Date.now() - this.lastSlow > 30000 || named.some((n) => !(n in this.desc)))) {
        this.slowing = true;
        this.slow().catch(() => {}).finally(() => { this.slowing = false; this.poll(); });
      }
      let hit = null;
      for (const n of named) {
        const text = `${n} ${this.desc[n] || ''}`;
        if (!TUNNEL.test(text)) continue;
        const v4 = (ifs[n] || []).find((a) => a.family === 'IPv4' && !a.internal);
        if (!v4) continue;
        hit = { adapter: n, desc: this.desc[n] || n, ip: v4.address, provider: (PROVIDERS.find(([re]) => re.test(text)) || [, 'VPN'])[1] };
        break;
      }
      const was = this.state;
      const on = !!hit;
      this.state = {
        on, provider: hit?.provider || null, adapter: hit?.adapter || null, desc: hit?.desc || null, ip: hit?.ip || null,
        since: on ? (was.on && was.adapter === hit.adapter ? was.since : Date.now()) : null, apps: this.apps,
      };
      if (on !== was.on || this.state.adapter !== was.adapter || this.state.provider !== was.provider || String(this.apps) !== String(was.apps)) this.emit('change', this.state);
    } catch {}
  }
}

module.exports = { Vpn };
