// Mirrors Windows notifications (the same ones shown in Notification Center).
// Windows stores them in %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db;
// we read it read-only with Node's built-in SQLite and watch the WAL file for changes.
// FrostShell never writes to that database: "dismiss" only hides items inside FrostShell.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');

const IS_WIN = process.platform === 'win32';
const DB = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
const FILETIME_EPOCH_MS = 11644473600000;
const FRESH_MS = 2 * 60 * 1000; // only pop up things that arrived in the last 2 minutes

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

function parseToast(xml) {
  const texts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
  let image = null;
  for (const m of xml.matchAll(/<image\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const src = (attrs.match(/\bsrc="([^"]+)"/) || [])[1];
    if (!src) continue;
    if (/placement="appLogoOverride"/.test(attrs) || !image) image = decode(src);
  }
  // only local files can be shown (ms-appx:// etc. need package context)
  if (image && /^[a-z]:\\/i.test(image)) image = 'file:///' + image.replace(/\\/g, '/');
  if (image && !/^file:\/\//i.test(image)) image = null;
  return { title: texts[0] || '', body: texts.slice(1).join('\n'), image };
}

function prettyAumid(aumid = '') {
  const base = aumid.split('!')[0].split('_')[0];
  const last = base.split(/[.\\]/).filter(Boolean).pop() || aumid;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^Windows /, '');
}

class Notifications extends EventEmitter {
  constructor() {
    super();
    this.list = [];
    this.seen = new Set();
    this.names = {};
    this.dismissed = new Set();
    this.db = null;
  }

  get dismissedFile() {
    return path.join(app.getPath('userData'), 'dismissed-notifications.json');
  }

  start({ demo = false } = {}) {
    try {
      this.dismissed = new Set(JSON.parse(fs.readFileSync(this.dismissedFile, 'utf8')));
    } catch {}
    if (demo || !IS_WIN) return this.startDemo();
    this.loadAppNames();
    this.check(true);
    if (fs.existsSync(DB + '-wal')) fs.watchFile(DB + '-wal', { interval: 1000 }, () => this.check());
    this.timer = setInterval(() => this.check(), 5000); // safety net
    this.namesTimer = setInterval(() => this.loadAppNames(), 10 * 60 * 1000);
  }

  // AUMID -> friendly app name, from the Start menu
  loadAppNames() {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, out) => {
        if (err) return;
        try {
          const map = {};
          for (const a of [].concat(JSON.parse(out))) if (a && a.AppID) map[a.AppID.toLowerCase()] = a.Name;
          this.names = map;
          this.list = this.list.map((n) => ({ ...n, appName: this.appName(n.app) }));
          this.emit('update', { list: this.visible(), fresh: [] });
        } catch {}
      }
    );
  }

  appName(aumid) {
    return this.names[(aumid || '').toLowerCase()] || prettyAumid(aumid);
  }

  open() {
    if (this.db) return this.db;
    const { DatabaseSync } = require('node:sqlite');
    try {
      this.db = new DatabaseSync(DB, { readOnly: true });
    } catch {
      // database busy/locked: read a snapshot copy instead
      const tmp = path.join(os.tmpdir(), 'frostshell-wpn');
      fs.mkdirSync(tmp, { recursive: true });
      for (const ext of ['', '-wal', '-shm']) {
        try {
          fs.copyFileSync(DB + ext, path.join(tmp, 'wpn.db' + ext));
        } catch {}
      }
      return new DatabaseSync(path.join(tmp, 'wpn.db'), { readOnly: true });
    }
    return this.db;
  }

  read() {
    const db = this.open();
    const rows = db
      .prepare(
        `SELECT n.Id AS id, (n.ArrivalTime / 10000 - ${FILETIME_EPOCH_MS}) AS ms, n.Payload AS payload, h.PrimaryId AS app
           FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
          WHERE n.Type = 'toast'
          ORDER BY n.ArrivalTime DESC LIMIT 80`
      )
      .all();
    if (db !== this.db) db.close();
    return rows.map((r) => {
      const xml = Buffer.from(r.payload || '').toString('utf8');
      // FILETIME (100ns since 1601) exceeds 2^53, so it's converted to ms inside SQL
      const ms = Number(r.ms || 0);
      return {
        id: String(r.id),
        app: r.app,
        appName: this.appName(r.app),
        time: ms > 0 ? ms : Date.now(),
        ...parseToast(xml),
      };
    });
  }

  check(initial = false) {
    let rows;
    try {
      rows = this.read();
    } catch (err) {
      this.db = null;
      if (initial) console.error('[notifications]', err.message);
      return;
    }
    const fresh = [];
    for (const n of rows) {
      if (this.seen.has(n.id)) continue;
      this.seen.add(n.id);
      if (!initial && Date.now() - n.time < FRESH_MS && !this.dismissed.has(n.id)) fresh.push(n);
    }
    const changed = initial || fresh.length || rows.length !== this.list.length || rows.some((n, i) => n.id !== this.list[i]?.id);
    this.list = rows;
    if (changed) this.emit('update', { list: this.visible(), fresh: fresh.reverse() });
  }

  visible() {
    return this.list.filter((n) => !this.dismissed.has(n.id) && (n.title || n.body));
  }

  dismiss(ids) {
    for (const id of [].concat(ids)) this.dismissed.add(String(id));
    const keep = [...this.dismissed].slice(-1000);
    this.dismissed = new Set(keep);
    try {
      fs.writeFileSync(this.dismissedFile, JSON.stringify(keep));
    } catch {}
    this.emit('update', { list: this.visible(), fresh: [] });
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.namesTimer);
    clearInterval(this.demoTimer);
    fs.unwatchFile(DB + '-wal');
    try {
      this.db && this.db.close();
    } catch {}
  }

  // ---- demo mode ----
  startDemo() {
    const samples = [
      { app: 'Messages', title: 'Rani', body: 'Jadi meeting jam 3 ya? Aku bawa laptop 👍' },
      { app: 'Mail', title: 'Invoice #2291 paid', body: 'Payment received. Thanks for your business!' },
      { app: 'Calendar', title: 'Design review in 10 min', body: 'Room 4B · with Dimas, Sarah' },
      { app: 'Downloads', title: 'Download complete', body: 'frostshell-setup-0.2.0.exe (84 MB)' },
      { app: 'Messages', title: 'Kevin', body: 'Bro, push repo-nya udah?' },
    ];
    let n = 0;
    const make = (s, ago = 0) => ({ id: `demo-${n++}`, app: s.app, appName: s.app, time: Date.now() - ago, title: s.title, body: s.body, image: null });
    this.list = [make(samples[1], 42 * 60e3), make(samples[2], 3 * 3600e3), make(samples[3], 26 * 3600e3)];
    let i = 0;
    this.demoTimer = setInterval(() => {
      const item = make(samples[[0, 4, 2][i++ % 3]]);
      this.list.unshift(item);
      this.emit('update', { list: this.visible(), fresh: [item] });
    }, 20000);
    setTimeout(() => this.emit('update', { list: this.visible(), fresh: [] }), 500);
  }
}

module.exports = new Notifications();
