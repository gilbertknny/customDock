// Now-playing info + media controls via a long-running PowerShell/WinRT bridge.
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const IS_WIN = process.platform === 'win32';
// PowerShell can't read files inside app.asar, so packaged builds unpack the script.
const SCRIPT = path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];

class Media extends EventEmitter {
  constructor() {
    super();
    this.state = { active: false };
    this.art = new Map(); // key -> data URL
    this.child = null;
    this.stopped = false;
    this.restarts = 0;
  }

  start({ demo = false } = {}) {
    if (demo || !IS_WIN) return this.startDemo();
    this.spawnWatcher();
  }

  spawnWatcher() {
    if (this.stopped) return;
    const child = spawn('powershell.exe', [...PS_ARGS, '-Mode', 'watch', '-ParentPid', String(process.pid)], {
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
        if (line) this.handle(line);
      }
    });
    child.stderr.on('data', (d) => console.error('[media]', String(d).trim()));
    child.on('exit', () => {
      this.child = null;
      if (this.stopped) return;
      const delay = Math.min(30000, 1000 * 2 ** this.restarts++);
      setTimeout(() => this.spawnWatcher(), delay);
    });
  }

  handle(line) {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    this.restarts = 0;
    if (data.active && data.art) {
      this.art.set(data.key, data.art);
      if (this.art.size > 20) this.art.delete(this.art.keys().next().value);
    }
    if (data.active) data.art = this.art.get(data.key) || null;
    this.state = data;
    this.emit('update', data);
  }

  command(cmd) {
    if (!['toggle', 'next', 'prev'].includes(cmd)) return;
    if (this.demoTimer) return this.demoCommand(cmd);
    if (!IS_WIN) return;
    spawn('powershell.exe', [...PS_ARGS, '-Mode', 'cmd', '-Cmd', cmd], { windowsHide: true });
    // optimistic UI update
    if (cmd === 'toggle' && this.state.active) {
      this.state = { ...this.state, playing: !this.state.playing };
      this.emit('update', this.state);
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.demoTimer);
    if (this.child) this.child.kill();
  }

  // ---- demo mode (non-Windows / --demo) ----
  startDemo() {
    const tracks = [
      { title: 'Glass Horizons', artist: 'Aurora Lane', duration: 214, hue: 280 },
      { title: 'Midnight Frost', artist: 'Neon Drift', duration: 187, hue: 190 },
      { title: 'Soft Focus', artist: 'Kaito & The Blur', duration: 242, hue: 20 },
    ];
    this.demo = { i: 0, pos: 40, playing: true, tracks };
    const tick = () => {
      const d = this.demo;
      if (d.playing) d.pos += 1;
      const t = d.tracks[d.i];
      if (d.pos >= t.duration) {
        d.i = (d.i + 1) % d.tracks.length;
        d.pos = 0;
      }
      this.emitDemo();
    };
    this.demoTimer = setInterval(tick, 1000);
    this.emitDemo();
  }

  emitDemo() {
    const d = this.demo;
    const t = d.tracks[d.i];
    const art =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${t.hue},90%,65%)"/><stop offset="1" stop-color="hsl(${t.hue + 60},80%,45%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="none" stroke="white" stroke-opacity=".7" stroke-width="5"/><circle cx="50" cy="50" r="5" fill="white"/></svg>`
      );
    this.state = {
      active: true,
      key: t.title,
      title: t.title,
      artist: t.artist,
      app: 'Spotify',
      playing: d.playing,
      position: d.pos,
      duration: t.duration,
      art,
    };
    this.emit('update', this.state);
  }

  demoCommand(cmd) {
    const d = this.demo;
    if (cmd === 'toggle') d.playing = !d.playing;
    if (cmd === 'next') (d.i = (d.i + 1) % d.tracks.length), (d.pos = 0);
    if (cmd === 'prev') (d.i = (d.i + d.tracks.length - 1) % d.tracks.length), (d.pos = 0);
    this.emitDemo();
  }
}

module.exports = new Media();
