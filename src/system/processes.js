// Polls running process names so the dock can show "running" indicators.
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

class Processes extends EventEmitter {
  constructor() {
    super();
    this.names = new Set();
    this.timer = null;
  }

  start(interval = 3000) {
    if (process.platform !== 'win32') return;
    const poll = () => {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return;
        const next = new Set();
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/^"([^"]+)"/);
          if (m) next.add(m[1].toLowerCase());
        }
        const changed = next.size !== this.names.size || [...next].some((n) => !this.names.has(n));
        this.names = next;
        if (changed) this.emit('update', [...next]);
      });
    };
    poll();
    this.timer = setInterval(poll, interval);
  }

  list() {
    return [...this.names];
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = new Processes();
