// FrostShell — glassmorphism dock + notch for Windows 11.
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  dialog,
  session,
  desktopCapturer,
} = require('electron');

const config = require('./config');
const media = require('./system/media');
const processes = require('./system/processes');
const stats = require('./system/stats');
const wallpaper = require('./system/wallpaper');
const icons = require('./system/icons');
const controls = require('./system/controls');
const notifications = require('./system/notifications');
const shellwatch = require('./system/shellwatch');
const apps = require('./system/apps');

const DEMO = process.argv.includes('--demo');
const ASSETS = path.join(__dirname, '..', 'assets');

protocol.registerSchemesAsPrivileged([
  { scheme: 'frost', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('dev.frostshell.app');
// Keep animating even when Windows thinks our transparent windows are occluded.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const windows = { dock: null, notch: null };
let tray = null;
let hiddenForFullscreen = false;
let settingsWin = null;

// ---------- helpers ----------

function expandPath(p) {
  if (!p) return p;
  return p.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? process.env[key] : m;
  });
}

const isUri = (p) => /^[a-z][a-z0-9+.-]+:/i.test(p) && !/^[a-z]:[\\/]/i.test(p);

function resolveTheme(cfg) {
  if (cfg.theme === 'dark' || cfg.theme === 'light') return cfg.theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function primary() {
  return screen.getPrimaryDisplay();
}

function broadcast(channel, payload) {
  for (const w of [...Object.values(windows), settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function runDetached(file, args = [], cwd) {
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', cwd, windowsHide: false });
    child.on('error', (err) => console.error('[launch]', err.message));
    child.unref();
  } catch (err) {
    console.error('[launch]', err.message);
  }
}

function launch(item) {
  if (!item || !item.path) return;
  const target = expandPath(item.path);
  if (target === 'frost:start') return shellwatch.send({ cmd: 'start' }); // the Start button
  // shell:RecycleBinFolder, shell:AppsFolder\<AUMID> (Store apps), …
  if (/^shell:/i.test(target)) return runDetached('explorer.exe', [target]);
  if (isUri(target)) return shell.openExternal(target);
  if (item.args && item.args.length) {
    const cwd = path.isAbsolute(target) ? path.dirname(target) : undefined;
    return runDetached(target, item.args.map(expandPath), cwd);
  }
  shell.openPath(target).then((err) => {
    if (err) console.error('[launch]', target, err);
  });
}

// ---------- windows ----------

function baseOptions(extra) {
  return {
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
    ...extra,
  };
}

const PREVIEW_SPACE = 190; // transparent, click-through room for hover previews

function dockBounds(cfg) {
  const d = primary();
  const area = cfg.dock.aboveTaskbar && !cfg.dock.autoHide && !cfg.dock.hideTaskbar ? d.workArea : d.bounds;
  const height = Math.ceil(cfg.dock.iconSize * cfg.dock.magnification + 110 + PREVIEW_SPACE);
  return { x: d.bounds.x, y: area.y + area.height - height, width: d.bounds.width, height };
}

function notchBounds() {
  const d = primary();
  const width = 640;
  const height = 560;
  return { x: Math.round(d.bounds.x + (d.bounds.width - width) / 2), y: d.bounds.y, width, height };
}

function createWindow(kind, bounds) {
  const win = new BrowserWindow(baseOptions(bounds));
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setIgnoreMouseEvents(true, { forward: true });
  // never navigate away from our page or open new windows (e.g. a dropped file/link)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', kind, 'index.html'));
  win.once('ready-to-show', () => !hiddenForFullscreen && win.showInactive());
  win.on('closed', () => (windows[kind] = null));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function applyConfig(cfg) {
  const want = { dock: cfg.dock.enabled, notch: cfg.notch.enabled };
  const bounds = { dock: () => dockBounds(cfg), notch: () => notchBounds() };
  for (const kind of ['dock', 'notch']) {
    const w = windows[kind];
    if (want[kind] && !w) windows[kind] = createWindow(kind, bounds[kind]());
    else if (!want[kind] && w) w.destroy();
    else if (w) w.setBounds(bounds[kind]());
  }
  broadcast('config', payloadConfig(cfg));
  shellwatch.setHideTaskbar(!!cfg.dock.hideTaskbar);
  setFullscreenHidden(cfg.hideOnFullscreen !== false && shellwatch.fullscreen);
  rebuildTray();
}

// Get out of the way of games, fullscreen video and presentations.
function setFullscreenHidden(hide) {
  if (hide === hiddenForFullscreen) return;
  hiddenForFullscreen = hide;
  for (const w of Object.values(windows)) {
    if (!w || w.isDestroyed()) continue;
    if (hide) w.hide();
    else w.showInactive();
  }
}

function payloadConfig(cfg) {
  return { config: cfg, theme: resolveTheme(cfg) };
}

function reposition() {
  applyConfig(config.get());
  for (const [kind, w] of Object.entries(windows)) {
    if (w) w.webContents.send('geometry', geometry(kind));
  }
}

function geometry(kind) {
  const w = windows[kind];
  const d = primary();
  return { display: d.bounds, window: w ? w.getBounds() : null };
}

// ---------- settings window ----------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const isWin = process.platform === 'win32';
  settingsWin = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 840,
    minHeight: 560,
    title: 'FrostShell Settings',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    // Windows 11 Mica behind the page; plain dark elsewhere
    backgroundColor: isWin ? '#00000000' : '#1c1e26',
    ...(isWin ? { backgroundMaterial: 'mica' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  settingsWin.removeMenu();
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
  if (process.argv.includes('--devtools')) settingsWin.webContents.openDevTools({ mode: 'detach' });
}

// Settings may only write well-formed dock items and known options.
function sanitizeItems(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const it of items.slice(0, 80)) {
    if (!it || typeof it !== 'object') continue;
    if (it.type === 'separator') {
      out.push({ type: 'separator' });
      continue;
    }
    if (typeof it.name !== 'string' || typeof it.path !== 'string' || !it.path.trim()) continue;
    const clean = { name: it.name.slice(0, 80), path: it.path.slice(0, 1024) };
    if (Array.isArray(it.args)) clean.args = it.args.filter((a) => typeof a === 'string').slice(0, 20);
    if (typeof it.icon === 'string' && it.icon) clean.icon = it.icon.slice(0, 1024);
    if (it.process === false || (typeof it.process === 'string' && it.process)) clean.process = it.process;
    out.push(clean);
  }
  return out;
}

const DOCK_OPTIONS = {
  iconSize: (v) => typeof v === 'number' && v >= 32 && v <= 80,
  magnification: (v) => typeof v === 'number' && v >= 1 && v <= 2.2,
  autoHide: (v) => typeof v === 'boolean',
  aboveTaskbar: (v) => typeof v === 'boolean',
  hideTaskbar: (v) => typeof v === 'boolean',
  iconStyle: (v) => v === 'square' || v === 'plain',
  showRunning: (v) => typeof v === 'boolean',
};

// ---------- dock editing ----------

function updateItems(fn) {
  const cfg = config.update((c) => fn(c.dock.items));
  broadcast('config', payloadConfig(cfg));
}

function addPaths(paths) {
  const items = [];
  for (const p of paths) {
    if (!p) continue;
    const name = path.basename(p).replace(/\.(lnk|exe|url|appref-ms)$/i, '');
    items.push({ name, path: p });
  }
  if (!items.length) return;
  updateItems((list) => {
    const sep = list.findIndex((i) => i.type === 'separator');
    list.splice(sep >= 0 ? sep : list.length, 0, ...items);
  });
}

async function addAppDialog() {
  const res = await dialog.showOpenDialog({
    title: 'Add app to FrostShell dock',
    defaultPath: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Apps & shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (!res.canceled) addPaths(res.filePaths);
}

// ---------- running apps (open windows -> dock) ----------
let appNames = {}; // AUMID (lowercase) -> Start-menu name
let runningGroups = [];

function groupWindows(list) {
  const groups = new Map();
  for (const w of list || []) {
    if (!w || !w.hwnd) continue;
    const aumid = w.aumid || null;
    const key = aumid ? `a:${aumid.toLowerCase()}` : w.path ? `p:${w.path.toLowerCase()}` : `h:${w.hwnd}`;
    let g = groups.get(key);
    if (!g) {
      const exe = w.path ? path.win32.basename(w.path) : null; // Windows paths, even when run elsewhere
      const name = (aumid && appNames[aumid.toLowerCase()]) || w.desc || (exe ? exe.replace(/\.exe$/i, '') : w.title);
      g = { key, aumid, path: w.path || null, exe, name, hwnds: [], titles: {} };
      groups.set(key, g);
    }
    g.hwnds.push(w.hwnd);
    g.titles[w.hwnd] = w.title || '';
  }
  return [...groups.values()];
}

function publishWindows() {
  runningGroups = groupWindows(shellwatch.windows);
  if (windows.dock && !windows.dock.isDestroyed()) windows.dock.webContents.send('windows', runningGroups);
}

const knownHwnds = (hwnds) => {
  const all = new Set(runningGroups.flatMap((g) => g.hwnds));
  return (Array.isArray(hwnds) ? hwnds : []).filter((h) => all.has(h));
};

function pinGroup(key) {
  const g = runningGroups.find((x) => x.key === key);
  if (!g) return;
  const item = { name: g.name || g.exe || 'App', path: g.aumid ? `shell:AppsFolder\\${g.aumid}` : g.path };
  if (g.exe && !/^applicationframehost\.exe$/i.test(g.exe)) item.process = g.exe;
  if (!item.path) return;
  updateItems((list) => {
    const sep = list.findIndex((i) => i.type === 'separator');
    list.splice(sep >= 0 ? sep : list.length, 0, item);
  });
}

// Default dock entries point at Store apps; on PCs without them (LTSC, debloated,
// company images) swap in the classic equivalents instead of showing dead icons.
const STORE_FALLBACKS = {
  'microsoft.windowsterminal_8wekyb3d8bbwe!app': { name: 'Windows PowerShell', path: '%WINDIR%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
  'microsoft.windowsnotepad_8wekyb3d8bbwe!app': { name: 'Notepad', path: '%WINDIR%\\System32\\notepad.exe' },
  'microsoft.windowscalculator_8wekyb3d8bbwe!app': { name: 'Calculator', path: '%WINDIR%\\System32\\calc.exe' },
};
function replaceMissingDefaults(list) {
  const installed = new Set(list.map((a) => String(a.id).toLowerCase()));
  let changed = false;
  const items = config.get().dock.items.map((it) => {
    const id = ((it.path || '').match(/^shell:AppsFolder\\(.+)$/i) || [])[1];
    const fb = id && STORE_FALLBACKS[id.toLowerCase()];
    if (!fb || installed.has(id.toLowerCase())) return it;
    changed = true;
    return { ...fb };
  });
  if (changed) applyConfig(config.update((c) => (c.dock.items = items)));
}

// ---------- IPC ----------
// Only our own bundled pages may talk to the main process. If anything else ever got
// loaded into a window (e.g. a dropped .html file), its IPC calls are ignored.
const RENDERER_ROOT = pathToFileURL(path.join(__dirname, 'renderer')).href;
const trusted = (e) => (e.senderFrame?.url || '').startsWith(RENDERER_ROOT);
const on = (ch, fn) => ipcMain.on(ch, (e, ...args) => trusted(e) && fn(e, ...args));
const handle = (ch, fn) =>
  ipcMain.handle(ch, (e, ...args) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return fn(e, ...args);
  });

handle('init', (e) => {
  const kind =
    settingsWin && settingsWin.webContents === e.sender
      ? 'settings'
      : Object.keys(windows).find((k) => windows[k] && windows[k].webContents === e.sender);
  const cfg = config.get();
  return {
    kind,
    demo: DEMO,
    platform: process.platform,
    ...payloadConfig(cfg),
    ...geometry(kind),
    wallpaper: wallpaper.url(),
    media: media.state,
    stats: stats.last || { cpu: 0, mem: 0 },
    running: processes.list(),
    notifications: notifications.visible(),
    windows: runningGroups,
  };
});

on('ignore', (e, ignore) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

on('launch', (_e, index) => launch(config.get().dock.items[index]));
handle('icon', (_e, item) => icons.iconFor(item || {}));
on('media', (_e, cmd) => media.command(cmd));
handle('controls', (_e, req) => controls.run(req));
on('notif-open', (_e, id) => {
  // bring up the app that sent it (Windows doesn't expose the toast's own activation)
  const n = notifications.list.find((x) => x.id === String(id));
  if (n && n.app && !DEMO) runDetached('explorer.exe', [`shell:AppsFolder\${n.app}`]);
});
on('open-settings', (_e, uri) => {
  if (typeof uri === 'string' && /^ms-settings:[a-z0-9-]*$/i.test(uri)) shell.openExternal(uri);
});
on('notif-dismiss', (_e, ids) => notifications.dismiss(ids || []));
on('dock-add', (_e, paths) => addPaths(Array.isArray(paths) ? paths : []));
// only windows that are really open right now can be activated/closed
on('win-activate', (_e, hwnds) => {
  const h = knownHwnds(hwnds);
  if (h.length) shellwatch.send({ cmd: 'activate', hwnds: h });
});
on('win-close', (_e, hwnds) => {
  const h = knownHwnds(hwnds);
  if (h.length) shellwatch.send({ cmd: 'close', hwnds: h });
});
on('dock-pin', (_e, key) => pinGroup(String(key)));

// Live window thumbnails for the dock's hover preview (only for windows that are open now)
handle('win-previews', async (_e, hwnds) => {
  const wanted = knownHwnds(hwnds);
  if (!wanted.length) return [];
  const titles = Object.assign({}, ...runningGroups.map((g) => g.titles || {}));
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 440, height: 260 }, fetchWindowIcons: false });
  } catch (err) {
    console.error('[previews]', err.message);
  }
  // window source ids look like "window:<hwnd>:0"
  const byHwnd = new Map(sources.map((src) => [Number(String(src.id).split(':')[1]), src]));
  return wanted.map((h) => {
    const src = byHwnd.get(h);
    const img = src && src.thumbnail && !src.thumbnail.isEmpty() ? src.thumbnail : null;
    const size = img ? img.getSize() : null;
    // minimized windows come back blank (or tiny); show them as "Minimized"
    const usable = img && size.width > 8 && size.height > 8;
    return { hwnd: h, title: titles[h] || (src && src.name) || '', image: usable ? img.toDataURL() : null };
  });
});
on('running-menu', (e, key) => {
  const g = runningGroups.find((x) => x.key === key);
  if (!g) return;
  Menu.buildFromTemplate([
    { label: g.name || g.exe || 'App', enabled: false },
    { type: 'separator' },
    { label: 'Keep in dock', click: () => pinGroup(g.key) },
    { label: 'New window', enabled: !!(g.aumid || g.path), click: () => (g.aumid ? runDetached('explorer.exe', [`shell:AppsFolder\\${g.aumid}`]) : runDetached(g.path)) },
    { type: 'separator' },
    { label: g.hwnds.length > 1 ? `Close ${g.hwnds.length} windows` : 'Close window', click: () => shellwatch.send({ cmd: 'close', hwnds: g.hwnds }) },
  ]).popup({ window: BrowserWindow.fromWebContents(e.sender) });
});
handle('apps-list', (_e, refresh) => apps.list({ demo: DEMO, refresh: !!refresh }));
handle('dock-set-items', (_e, items) => {
  const clean = sanitizeItems(items);
  if (!clean) return false;
  applyConfig(config.update((c) => (c.dock.items = clean)));
  return true;
});
handle('dock-set-options', (_e, opts) => {
  if (!opts || typeof opts !== 'object') return false;
  const next = config.update((c) => {
    for (const [k, v] of Object.entries(opts)) if (DOCK_OPTIONS[k] && DOCK_OPTIONS[k](v)) c.dock[k] = v;
  });
  applyConfig(next);
  return true;
});
handle('browse-apps', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Choose an app for the dock',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Apps & shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled) return [];
  return res.filePaths.map((p) => ({ name: path.basename(p).replace(/\.(lnk|exe|url|bat|cmd)$/i, ''), path: p }));
});
on('open-settings-window', () => openSettings());
// the notch is non-focusable so it never steals focus; it opts in only while you type (Wi-Fi password)
on('set-focusable', (e, focusable) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win === settingsWin) return;
  win.setFocusable(!!focusable);
  if (focusable) win.focus();
});

on('dock-reorder', (_e, from, to) => {
  updateItems((list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    const [it] = list.splice(from, 1);
    list.splice(to, 0, it);
  });
});

on('action', (_e, index) => {
  // only quick actions defined in the user's own config can be run
  const a = (config.get().notch.quickActions || [])[index];
  if (!a) return;
  if (a.uri && /^shell:/i.test(a.uri)) runDetached('explorer.exe', [a.uri]);
  else if (a.uri) shell.openExternal(a.uri);
  else if (a.path) runDetached(expandPath(a.path), (a.args || []).map(expandPath));
});

on('dock-menu', (e, index, groupKey) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const running = groupKey ? runningGroups.find((x) => x.key === groupKey) : null;
  const cfg = config.get();
  const item = index >= 0 ? cfg.dock.items[index] : null;
  const tpl = [];
  if (item && item.type === 'separator') {
    tpl.push({ label: 'Remove separator', click: () => updateItems((l) => l.splice(index, 1)) });
  } else if (item) {
    const target = expandPath(item.path || '');
    tpl.push(
      { label: `Open ${item.name}`, click: () => launch(item) },
      {
        label: 'Show file location',
        enabled: !isUri(target) && path.isAbsolute(target),
        click: () => shell.showItemInFolder(target),
      },
      ...(running
        ? [
            { type: 'separator' },
            {
              label: running.hwnds.length > 1 ? `Close ${running.hwnds.length} windows` : 'Close window',
              click: () => shellwatch.send({ cmd: 'close', hwnds: running.hwnds }),
            },
          ]
        : []),
      { type: 'separator' },
      { label: 'Remove from dock', click: () => updateItems((l) => l.splice(index, 1)) }
    );
  }
  if (tpl.length) tpl.push({ type: 'separator' });
  tpl.push(
    { label: 'Add apps…', click: openSettings },
    { label: 'Browse for an app…', click: addAppDialog },
    { label: 'Add separator', click: () => updateItems((l) => l.push({ type: 'separator' })) },
    {
      label: 'Auto-hide dock',
      type: 'checkbox',
      checked: cfg.dock.autoHide,
      click: () => applyConfig(config.update((c) => (c.dock.autoHide = !c.dock.autoHide))),
    },
    { type: 'separator' },
    { label: 'Dock settings…', click: openSettings },
    { label: 'Quit FrostShell', click: () => app.quit() }
  );
  Menu.buildFromTemplate(tpl).popup({ window: win });
});

// ---------- tray ----------

function rebuildTray() {
  if (!tray) return;
  const cfg = config.get();
  const set = (fn) => () => applyConfig(config.update(fn));
  const radio = (label, checked, fn) => ({ label, type: 'radio', checked, click: set(fn) });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'FrostShell', enabled: false },
      { type: 'separator' },
      { label: 'Dock', type: 'checkbox', checked: cfg.dock.enabled, click: set((c) => (c.dock.enabled = !c.dock.enabled)) },
      { label: 'Notch', type: 'checkbox', checked: cfg.notch.enabled, click: set((c) => (c.notch.enabled = !c.notch.enabled)) },
      { label: 'Auto-hide dock', type: 'checkbox', checked: cfg.dock.autoHide, click: set((c) => (c.dock.autoHide = !c.dock.autoHide)) },
      { label: 'Settings…', click: openSettings },
      { label: 'Add apps to dock…', click: openSettings },
      {
        label: 'Hide Windows taskbar',
        type: 'checkbox',
        checked: !!cfg.dock.hideTaskbar,
        click: set((c) => (c.dock.hideTaskbar = !c.dock.hideTaskbar)),
      },
      {
        label: 'Hide over fullscreen apps',
        type: 'checkbox',
        checked: cfg.hideOnFullscreen !== false,
        click: set((c) => (c.hideOnFullscreen = c.hideOnFullscreen === false)),
      },
      { type: 'separator' },
      {
        label: 'Notch style',
        submenu: [
          radio('Glass', cfg.notch.style === 'glass', (c) => (c.notch.style = 'glass')),
          radio('Black', cfg.notch.style === 'black', (c) => (c.notch.style = 'black')),
        ],
      },
      {
        label: 'Glass effect',
        submenu: [
          radio('Wallpaper blur', cfg.glass.mode === 'wallpaper', (c) => (c.glass.mode = 'wallpaper')),
          radio('Tint only', cfg.glass.mode === 'tint', (c) => (c.glass.mode = 'tint')),
        ],
      },
      {
        label: 'Theme',
        submenu: [
          radio('Follow Windows', cfg.theme === 'auto', (c) => (c.theme = 'auto')),
          radio('Dark', cfg.theme === 'dark', (c) => (c.theme = 'dark')),
          radio('Light', cfg.theme === 'light', (c) => (c.theme = 'light')),
        ],
      },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }),
      },
      { label: 'Edit config…', click: () => shell.openPath(config.file()) },
      { label: 'Reload', click: () => Object.values(windows).forEach((w) => w && w.reload()) },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('FrostShell');
  rebuildTray();
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  // no camera/mic/geolocation/notifications/etc. for any page, ever
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  protocol.handle('frost', (req) => {
    const url = new URL(req.url);
    if (url.host === 'wallpaper') return wallpaper.response();
    return new Response('not found', { status: 404 });
  });

  const cfg = config.load();
  wallpaper.start({ demo: DEMO });
  media.start({ demo: DEMO });
  controls.start({ demo: DEMO });
  notifications.start({ demo: DEMO });
  shellwatch.start({ hideTaskbar: !!cfg.dock.hideTaskbar });
  processes.start();
  stats.start();

  media.on('update', (s) => broadcast('media', s));
  notifications.on('update', (p) => broadcast('notifications', p));
  shellwatch.on('fullscreen', (fs) => setFullscreenHidden(config.get().hideOnFullscreen !== false && fs));
  shellwatch.on('level', (p, first) => !first && broadcast('osd', p)); // hardware keys -> notch OSD
  shellwatch.on('windows', publishWindows);
  apps.list({ demo: DEMO }).then((list) => {
    appNames = Object.fromEntries((list || []).map((a) => [String(a.id).toLowerCase(), a.name]));
    publishWindows();
    if (!DEMO && list && list.length) replaceMissingDefaults(list);
  });
  processes.on('update', (list) => broadcast('running', list));
  stats.on('update', (s) => broadcast('stats', s));
  wallpaper.on('update', (url) => broadcast('wallpaper', url));
  nativeTheme.on('updated', () => broadcast('config', payloadConfig(config.get())));
  config.watch((next) => {
    icons.clear();
    applyConfig(next);
  });

  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  createTray();
  applyConfig(cfg);
});

app.on('second-instance', () => openSettings()); // launching FrostShell again opens Settings

app.on('window-all-closed', (e) => e.preventDefault()); // keep running in tray

app.on('will-quit', () => {
  media.stop();
  controls.stop();
  notifications.stop();
  shellwatch.stop(); // restores the Windows taskbar if we hid it
  processes.stop();
  stats.stop();
  wallpaper.stop();
});
