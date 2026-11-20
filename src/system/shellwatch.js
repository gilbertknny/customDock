// Runs shellwatch.ps1: fullscreen detection, hardware volume/brightness changes,
// and (optionally) keeping the Windows taskbar hidden while FrostShell runs.
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const IS_WIN = process.platform === 'win32';
const SCRIPT = path.join(__dirname, 'shellwatch.ps1').replace('app.asar', 'app.asar.unpacked');
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];

class ShellWatch extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.hideTaskbar = false;
    this.origAutoHide = null; // taskbar state before we touched it
    this.fullscreen = false;
    this.seen = {}; // first reading of volume/brightness is a baseline, not a change
  }

  start({ hideTaskbar = false } = {}) {
    if (!IS_WIN) return;
    this.hideTaskbar = !!hideTaskbar;
    this.spawn();
  }

  spawn() {
    const child = spawn('powershell.exe', [...PS, '-ParentPid', String(process.pid), '-HideTaskbar', this.hideTaskbar ? '1' : '0'], {
      windowsHide: true,
    });
    this.child = child;
    this.seen = {};
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('{')) this.handle(line);
      }
    });
    child.stderr.on('data', (d) => console.error('[shellwatch]', String(d).trim()));
    child.on('exit', () => {
      if (this.child !== child) return; // replaced on purpose
      this.child = null;
      if (!this.stopped) setTimeout(() => this.spawn(), 3000);
    });
  }

  handle(line) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.t === 'taskbar') this.origAutoHide = !!m.autohide;
    if (m.t === 'fullscreen') {
      this.fullscreen = !!m.v;
      this.emit('fullscreen', this.fullscreen);
    }
    if (m.t === 'volume' || m.t === 'brightness') {
      const first = !this.seen[m.t];
      this.seen[m.t] = true;
      const payload = m.t === 'volume' ? { kind: 'volume', value: m.v, muted: !!m.m } : { kind: 'brightness', value: m.v / 100 };
      this.emit('level', payload, first);
    }
  }

  // switching taskbar hiding on/off restarts the loop
  setHideTaskbar(on) {
    if (!IS_WIN || !!on === this.hideTaskbar) return;
    const was = this.origAutoHide;
    this.kill(was);
    this.hideTaskbar = !!on;
    this.spawn();
  }

  kill(origAutoHide = this.origAutoHide) {
    const child = this.child;
    this.child = null;
    if (child) child.kill(); // hard kill skips the script's own cleanup...
    if (this.hideTaskbar && origAutoHide !== null) this.restore(origAutoHide); // ...so restore explicitly
  }

  restore(autoHide) {
    try {
      execFileSync('powershell.exe', [...PS, '-Restore', '-WasAutoHide', autoHide ? '1' : '0'], { windowsHide: true, timeout: 8000 });
    } catch (err) {
      console.error('[shellwatch] restore failed', err.message);
    }
  }

  stop() {
    this.stopped = true;
    this.kill();
  }
}

module.exports = new ShellWatch();
