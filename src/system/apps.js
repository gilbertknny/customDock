// Installed apps, as listed in the Start menu (Store apps + desktop apps), for the
// "Add apps" list in Settings. Launch target is always shell:AppsFolder\<AUMID>,
// which works for both kinds; the exe name (for the running dot) comes from the
// matching Start-menu shortcut when there is one.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { shell } = require('electron');

const IS_WIN = process.platform === 'win32';
const JUNK = /uninstall|deinstall|readme|release notes|help$|documentation|website|license/i;
const JUNK_ID = /\.(chm|txt|pdf|html?|url|rtf)$|^https?:/i;

const DEMO_APPS = [
  'Calculator', 'Camera', 'Discord', 'Excel', 'File Explorer', 'Figma', 'Google Chrome', 'Microsoft Edge',
  'Microsoft Teams', 'Notepad', 'Notion', 'Paint', 'Photos', 'PowerPoint', 'Settings', 'Slack', 'Spotify',
  'Terminal', 'Visual Studio Code', 'WhatsApp', 'Word',
].map((name) => ({ name, id: `demo.${name.replace(/\W/g, '')}`, exe: null }));

function walkLinks(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkLinks(p, out, depth + 1);
    else if (/\.lnk$/i.test(e.name)) out.push(p);
  }
  return out;
}

function shortcutTargets() {
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const map = {};
  for (const root of roots) {
    for (const lnk of walkLinks(root)) {
      try {
        const t = shell.readShortcutLink(lnk).target;
        if (t && /\.exe$/i.test(t)) map[path.basename(lnk, '.lnk').toLowerCase()] = t;
      } catch {}
    }
  }
  return map;
}

let cache = null;

function list({ demo = false, refresh = false } = {}) {
  if (demo || !IS_WIN) return Promise.resolve(DEMO_APPS);
  if (cache && !refresh) return cache;
  cache = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, out) => {
        if (err) return resolve([]);
        let raw = [];
        try {
          raw = [].concat(JSON.parse(out));
        } catch {}
        const targets = shortcutTargets();
        const seen = new Set();
        const apps = [];
        for (const a of raw) {
          if (!a || !a.Name || !a.AppID) continue;
          if (JUNK.test(a.Name) || JUNK_ID.test(a.AppID)) continue;
          const key = a.Name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const fromId = /\.exe$/i.test(a.AppID) ? path.basename(a.AppID.replace(/^\{[^}]+\}\\?/, '')) : null;
          const target = targets[key];
          apps.push({ name: a.Name, id: a.AppID, exe: target ? path.basename(target) : fromId });
        }
        apps.sort((x, y) => x.name.localeCompare(y.name));
        resolve(apps);
      }
    );
  });
  return cache;
}

module.exports = { list };
