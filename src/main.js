// FrostShell — glassmorphism dock + Dynamic Island for Windows 11.
const path = require('path');
const { spawn } = require('child_process');
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
} = require('electron');

const config = require('./config');
const media = require('./system/media');
const processes = require('./system/processes');
const stats = require('./system/stats');
const wallpaper = require('./system/wallpaper');
const icons = require('./system/icons');

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

const windows = { dock: null, island: null };
let tray = null;

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
  for (const w of Object.values(windows)) {
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

function dockBounds(cfg) {
  const d = primary();
  const area = cfg.dock.aboveTaskbar && !cfg.dock.autoHide ? d.workArea : d.bounds;
  const height = Math.ceil(cfg.dock.iconSize * cfg.dock.magnification + 110);
  return { x: d.bounds.x, y: area.y + area.height - height, width: d.bounds.width, height };
}

function islandBounds() {
  const d = primary();
  const width = 620;
  const height = 320;
  return { x: Math.round(d.bounds.x + (d.bounds.width - width) / 2), y: d.bounds.y, width, height };
}

function createWindow(kind, bounds) {
  const win = new BrowserWindow(baseOptions(bounds));
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', kind, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => (windows[kind] = null));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function applyConfig(cfg) {
  const want = { dock: cfg.dock.enabled, island: cfg.island.enabled };
  const bounds = { dock: () => dockBounds(cfg), island: () => islandBounds() };
  for (const kind of ['dock', 'island']) {
    const w = windows[kind];
    if (want[kind] && !w) windows[kind] = createWindow(kind, bounds[kind]());
    else if (!want[kind] && w) w.destroy();
    else if (w) w.setBounds(bounds[kind]());
  }
  broadcast('config', payloadConfig(cfg));
  rebuildTray();
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

// ---------- IPC ----------

ipcMain.handle('init', (e) => {
  const kind = Object.keys(windows).find((k) => windows[k] && windows[k].webContents === e.sender);
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
  };
});

ipcMain.on('ignore', (e, ignore) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.on('launch', (_e, index) => launch(config.get().dock.items[index]));
ipcMain.handle('icon', (_e, item) => icons.iconFor(item || {}));
ipcMain.on('media', (_e, cmd) => media.command(cmd));
ipcMain.on('dock-add', (_e, paths) => addPaths(Array.isArray(paths) ? paths : []));

ipcMain.on('dock-reorder', (_e, from, to) => {
  updateItems((list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    const [it] = list.splice(from, 1);
    list.splice(to, 0, it);
  });
});

ipcMain.on('action', (_e, a) => {
  if (!a) return;
  if (a.uri && /^shell:/i.test(a.uri)) runDetached('explorer.exe', [a.uri]);
  else if (a.uri) shell.openExternal(a.uri);
  else if (a.path) runDetached(expandPath(a.path), (a.args || []).map(expandPath));
});

ipcMain.on('dock-menu', (e, index) => {
  const win = BrowserWindow.fromWebContents(e.sender);
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
      { type: 'separator' },
      { label: 'Remove from dock', click: () => updateItems((l) => l.splice(index, 1)) }
    );
  }
  if (tpl.length) tpl.push({ type: 'separator' });
  tpl.push(
    { label: 'Add app…', click: addAppDialog },
    { label: 'Add separator', click: () => updateItems((l) => l.push({ type: 'separator' })) },
    {
      label: 'Auto-hide dock',
      type: 'checkbox',
      checked: cfg.dock.autoHide,
      click: () => applyConfig(config.update((c) => (c.dock.autoHide = !c.dock.autoHide))),
    },
    { type: 'separator' },
    { label: 'Edit config…', click: () => shell.openPath(config.file()) },
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
      { label: 'Dynamic Island', type: 'checkbox', checked: cfg.island.enabled, click: set((c) => (c.island.enabled = !c.island.enabled)) },
      { label: 'Auto-hide dock', type: 'checkbox', checked: cfg.dock.autoHide, click: set((c) => (c.dock.autoHide = !c.dock.autoHide)) },
      { label: 'Add app to dock…', click: addAppDialog },
      { type: 'separator' },
      {
        label: 'Island style',
        submenu: [
          radio('Glass', cfg.island.style === 'glass', (c) => (c.island.style = 'glass')),
          radio('Black (iPhone)', cfg.island.style === 'black', (c) => (c.island.style = 'black')),
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
  protocol.handle('frost', (req) => {
    const url = new URL(req.url);
    if (url.host === 'wallpaper') return wallpaper.response();
    return new Response('not found', { status: 404 });
  });

  const cfg = config.load();
  wallpaper.start({ demo: DEMO });
  media.start({ demo: DEMO });
  processes.start();
  stats.start();

  media.on('update', (s) => broadcast('media', s));
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

app.on('second-instance', () => {
  if (tray) tray.popUpContextMenu();
});

app.on('window-all-closed', (e) => e.preventDefault()); // keep running in tray

app.on('will-quit', () => {
  media.stop();
  processes.stop();
  stats.stop();
  wallpaper.stop();
});
