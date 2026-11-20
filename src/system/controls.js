// Quick-settings bridge: volume, mute, brightness, Wi-Fi, Bluetooth, airplane,
// low power and do-not-disturb, via one persistent PowerShell process (controls.ps1).
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const SCRIPT = path.join(__dirname, 'controls.ps1').replace('app.asar', 'app.asar.unpacked');
const COMMANDS = [
  'state', 'setVolume', 'setMute', 'setBrightness', 'setRadio', 'setAirplane', 'setLowPower', 'setDnd',
  'wifiList', 'wifiConnect', 'wifiDisconnect', 'wifiForget',
];
// scanning and connecting take a while; everything else should answer fast
const TIMEOUT = { wifiList: 15000, wifiConnect: 30000, wifiDisconnect: 10000 };

class Controls {
  constructor() {
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.state = null;
    this.demo = !IS_WIN;
  }

  start({ demo = false } = {}) {
    this.demo = demo || !IS_WIN;
    if (this.demo) {
      this.state = {
        volume: 0.62, muted: false, brightness: 70, wifi: true, bluetooth: true,
        airplane: false, ssid: 'Rumah_5G', signal: 82, ethernet: false, lowPower: false, dnd: false,
      };
    }
  }

  ensure() {
    if (this.child || this.demo) return;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true,
    });
    this.child = child;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try {
          const res = JSON.parse(line);
          this.state = res.state || this.state;
          const p = this.pending.get(res.id);
          if (p) {
            this.pending.delete(res.id);
            p.resolve(res);
          }
        } catch {}
      }
    });
    child.stderr.on('data', (d) => console.error('[controls]', String(d).trim()));
    child.on('exit', () => {
      this.child = null;
      for (const p of this.pending.values()) p.resolve({ ok: false, error: 'bridge exited', state: this.state });
      this.pending.clear();
    });
  }

  run(req) {
    if (!req || !COMMANDS.includes(req.cmd)) return Promise.resolve({ ok: false, error: 'unknown command' });
    if (this.demo) return Promise.resolve(this.runDemo(req));
    this.ensure();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), 60000 + (TIMEOUT[req.cmd] || 0)); // free ~60 MB when idle
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.child.stdin.write(JSON.stringify({ ...req, id }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ ok: false, error: 'timeout', state: this.state });
        }
      }, TIMEOUT[req.cmd] || 8000);
    });
  }

  runDemo(req) {
    const s = this.state;
    if (!this.demoNets) {
      this.demoNets = [
        { ssid: 'Rumah_5G', signal: 92, secure: true, auth: 'personal', connected: true, saved: true, profile: 'Rumah_5G' },
        { ssid: 'Rumah_2.4G', signal: 78, secure: true, auth: 'personal', connected: false, saved: true, profile: 'Rumah_2.4G' },
        { ssid: 'Kopi Kenangan Free WiFi', signal: 55, secure: false, auth: 'open', connected: false, saved: false },
        { ssid: 'IndiHome-7F2A', signal: 48, secure: true, auth: 'personal', connected: false, saved: false },
        { ssid: 'KANTOR-CORP', signal: 30, secure: true, auth: 'enterprise', connected: false, saved: false },
      ];
    }
    const nets = this.demoNets;
    const wifiOut = (extra = {}) => ({ networks: s.wifi ? nets.map((n) => ({ ...n })) : [], ...(s.wifi ? {} : { error: 'off' }), ...extra });
    if (req.cmd === 'wifiList') return { ok: true, wifi: wifiOut(), state: { ...s } };
    if (req.cmd === 'wifiDisconnect') {
      nets.forEach((n) => (n.connected = false));
      s.ssid = null;
      return { ok: true, wifi: wifiOut(), state: { ...s } };
    }
    if (req.cmd === 'wifiForget') {
      const n = nets.find((x) => x.profile === req.profile);
      if (n) Object.assign(n, { saved: false, connected: false, profile: undefined });
      return { ok: true, wifi: wifiOut(), state: { ...s } };
    }
    if (req.cmd === 'wifiConnect') {
      const n = nets.find((x) => x.ssid === req.ssid);
      let result = 'ok';
      if (!n) result = 'notfound';
      else if (n.auth === 'enterprise') result = 'enterprise';
      else if (n.secure && !n.saved && !req.password) result = 'needpassword';
      else if (n.secure && !n.saved && req.password !== 'password123') result = 'password';
      if (result === 'ok') {
        nets.forEach((x) => (x.connected = false));
        Object.assign(n, { connected: true, saved: true, profile: n.ssid });
        s.ssid = n.ssid;
      }
      return { ok: true, wifi: wifiOut({ result }), state: { ...s } };
    }
    if (req.cmd === 'setVolume') (s.volume = req.value), req.value > 0 && (s.muted = false);
    if (req.cmd === 'setMute') s.muted = !!req.value;
    if (req.cmd === 'setBrightness') s.brightness = req.value;
    if (req.cmd === 'setRadio') s[req.kind === 'WiFi' ? 'wifi' : 'bluetooth'] = !!req.on;
    if (req.cmd === 'setAirplane') (s.airplane = !!req.on), (s.wifi = !req.on), (s.bluetooth = !req.on);
    if (req.cmd === 'setLowPower') s.lowPower = !!req.on;
    if (req.cmd === 'setDnd') s.dnd = !!req.on;
    if (req.cmd === 'setRadio') s.airplane = !s.wifi && !s.bluetooth;
    s.ssid = s.wifi ? 'Rumah_5G' : null;
    return { ok: true, state: { ...s } };
  }

  stop() {
    clearTimeout(this.idleTimer);
    if (this.child) this.child.stdin.end(); // the script exits when stdin closes
  }
}

module.exports = new Controls();
