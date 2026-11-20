// Finds the current desktop wallpaper so the renderer can fake "real" glass blur
// (CSS backdrop-filter can't see the desktop behind a transparent window).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const DEMO = path.join(__dirname, '..', '..', 'assets', 'demo-wallpaper.jpg');

function registryWallpaper() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const m = out.match(/WallPaper\s+REG_SZ\s+(.+)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function findWallpaper(demo) {
  if (demo || process.platform !== 'win32') return fs.existsSync(DEMO) ? DEMO : null;
  // TranscodedWallpaper is what Windows actually renders (also covers Spotlight/slideshow).
  const candidates = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'),
    registryWallpaper(),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'application/octet-stream';
}

class Wallpaper extends EventEmitter {
  start({ demo = false } = {}) {
    this.demo = demo;
    this.file = findWallpaper(demo);
    this.version = this.mtime();
    if (!this.file) return;
    fs.watchFile(this.file, { interval: 4000 }, () => {
      const v = this.mtime();
      if (v !== this.version) {
        this.version = v;
        this.emit('update', this.url());
      }
    });
  }

  mtime() {
    try {
      return Math.floor(fs.statSync(this.file).mtimeMs);
    } catch {
      return 0;
    }
  }

  url() {
    return this.file ? `frost://wallpaper/current?v=${this.version}` : null;
  }

  // used by the frost:// protocol handler
  async response() {
    if (!this.file) return new Response('no wallpaper', { status: 404 });
    const buf = await fs.promises.readFile(this.file);
    return new Response(buf, { headers: { 'content-type': sniff(buf), 'cache-control': 'max-age=31536000' } });
  }

  stop() {
    if (this.file) fs.unwatchFile(this.file);
  }
}

module.exports = new Wallpaper();
