// Resolves dock items to their real Windows icons (256 px when available).
// Requests are batched into a single PowerShell run of icons.ps1.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell, nativeImage } = require('electron');

const IS_WIN = process.platform === 'win32';
const SCRIPT = path.join(__dirname, 'icons.ps1').replace('app.asar', 'app.asar.unpacked');
const WINDIR = process.env.WINDIR || 'C:\\Windows';
const GENERIC = { kind: 'file', file: `${WINDIR}\\System32\\imageres.dll`, index: -15 }; // generic application icon

// Windows URIs / shell folders whose icon lives somewhere predictable.
const SETTINGS_AUMID = 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel';
const KNOWN = {
  'ms-settings:': [
    { kind: 'shell', path: `shell:AppsFolder\\${SETTINGS_AUMID}` },
    { kind: 'appx', family: 'windows.immersivecontrolpanel_cw5n1h2txyewy' },
    { kind: 'file', file: `${WINDIR}\\ImmersiveControlPanel\\SystemSettings.exe`, index: 0 },
  ],
  'calculator:': [
    { kind: 'shell', path: 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    { kind: 'appx', family: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe' },
  ],
  'ms-screenclip:': [{ kind: 'appx', family: 'Microsoft.ScreenSketch_8wekyb3d8bbwe' }],
  'shell:recyclebinfolder': [
    { kind: 'shell', path: 'shell:RecycleBinFolder' },
    { kind: 'file', file: `${WINDIR}\\System32\\imageres.dll`, index: -55 },
  ],
  'shell:mycomputerfolder': [{ kind: 'file', file: `${WINDIR}\\System32\\imageres.dll`, index: -109 }],
  'shell:downloads': [{ kind: 'file', file: `${WINDIR}\\System32\\imageres.dll`, index: -184 }],
};

function expand(p) {
  return (p || '').replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? process.env[key] : m;
  });
}

// App-execution aliases (e.g. %LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe) are 0-byte
// reparse points; the owning package is the subfolder that contains the same alias.
function aliasFamily(file) {
  const dir = path.dirname(file);
  if (!/\\WindowsApps$/i.test(dir)) return null;
  try {
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (sub.isDirectory() && fs.existsSync(path.join(dir, sub.name, path.basename(file)))) return sub.name;
    }
  } catch {}
  return null;
}

function parseIconSpec(spec) {
  // "C:\\path\\file.dll,-55"  or  "file.exe,3"
  const m = spec.match(/^(.*?),\s*(-?\d+)$/);
  return m ? { kind: 'file', file: m[1], index: Number(m[2]) } : null;
}

// Build an ordered list of candidates for one dock item.
function candidates(item) {
  const list = [];
  const icon = expand(item.icon);
  if (icon) {
    const res = parseIconSpec(icon);
    if (res) list.push(res);
    else if (/\.(exe|dll|ico|icl|cpl)$/i.test(icon)) list.push({ kind: 'file', file: icon, index: 0 });
  }

  let target = expand(item.path);
  const args = (item.args || []).map(expand);
  // explorer.exe shell:Something  -> treat the shell target as the thing to show
  if (/(^|\\)explorer(\.exe)?$/i.test(target) && args[0] && /^shell:/i.test(args[0])) target = args[0];

  const lower = target.toLowerCase();
  if (KNOWN[lower]) list.push(...KNOWN[lower]);

  const appsFolder = target.match(/^shell:appsfolder\\(.+)$/i);
  if (appsFolder) {
    // Explorer's own icon for the Start entry works for Store *and* Win32 apps
    list.push({ kind: 'shell', path: target });
    const [family, appId] = appsFolder[1].split('!');
    if (family.includes('_')) list.push({ kind: 'appx', family, app: appId });
  } else if (/^shell:/i.test(target) && !KNOWN[lower]) {
    list.push({ kind: 'shell', path: target });
  }

  if (path.isAbsolute(target)) {
    // the exact icon Explorer/taskbar show (handles .lnk overrides, Squirrel apps, etc.)
    list.push({ kind: 'shell', path: target });
    if (/\.lnk$/i.test(target)) {
      try {
        const link = shell.readShortcutLink(target);
        if (link.icon) list.push({ kind: 'file', file: link.icon, index: link.iconIndex || 0 });
        if (link.target) target = link.target;
      } catch {}
    }
    const fam = aliasFamily(target);
    if (fam) list.push({ kind: 'appx', family: fam });
    list.push({ kind: 'file', file: target, index: 0 });
  }
  return list;
}

const cache = new Map();
let queue = [];
let timer = null;

function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  const requests = batch.map((b) => ({ key: b.key, candidates: [...b.candidates, GENERIC] }));
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
    windowsHide: true,
  });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => console.error('[icons]', String(d).trim()));
  const finish = () => {
    let map = {};
    try {
      map = JSON.parse(out || '{}');
    } catch {}
    for (const b of batch) b.resolve(map[b.key] || null);
  };
  child.on('close', finish);
  child.on('error', finish);
  child.stdin.end(JSON.stringify(requests));
}

function viaPowerShell(key, list) {
  return new Promise((resolve) => {
    queue.push({ key, candidates: list, resolve });
    clearTimeout(timer);
    timer = setTimeout(flush, 40);
  });
}

async function fallback(item) {
  // non-Windows dev runs, or anything PowerShell couldn't read
  const icon = expand(item.icon);
  if (icon && /\.(png|jpe?g|webp|bmp|gif)$/i.test(icon)) {
    const img = nativeImage.createFromPath(icon);
    if (!img.isEmpty()) return img.toDataURL();
  }
  const target = expand(item.path);
  if (target && path.isAbsolute(target) && fs.existsSync(target)) {
    const img = await app.getFileIcon(target, { size: 'large' });
    if (!img.isEmpty()) return img.toDataURL();
  }
  return null;
}

async function iconFor(item) {
  const key = JSON.stringify([item.icon || '', item.path || '', item.args || []]);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const icon = expand(item.icon);
    // explicit image files are used as-is
    if (icon && /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(icon)) return fallback(item);
    if (IS_WIN) {
      const url = await viaPowerShell(key, candidates(item));
      if (url) return url;
    }
    return fallback(item);
  })();
  cache.set(key, p);
  return p;
}

module.exports = { iconFor, clear: () => cache.clear(), candidates };
