// CPU / RAM usage sampled from the os module.
const os = require('os');
const { EventEmitter } = require('events');

function snapshot() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

class Stats extends EventEmitter {
  start(interval = 2000) {
    let prev = snapshot();
    this.timer = setInterval(() => {
      const cur = snapshot();
      const dt = cur.total - prev.total;
      const cpu = dt > 0 ? 1 - (cur.idle - prev.idle) / dt : 0;
      prev = cur;
      const mem = 1 - os.freemem() / os.totalmem();
      this.last = { cpu: Math.max(0, Math.min(1, cpu)), mem };
      this.emit('update', this.last);
    }, interval);
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = new Stats();
