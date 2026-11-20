// Minimal, explicit bridge between renderers and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = ['config', 'media', 'stats', 'running', 'wallpaper', 'geometry', 'notifications', 'osd', 'windows'];

contextBridge.exposeInMainWorld('frost', {
  init: () => ipcRenderer.invoke('init'),
  setIgnore: (ignore) => ipcRenderer.send('ignore', ignore),
  launch: (index) => ipcRenderer.send('launch', index),
  dockMenu: (index, groupKey) => ipcRenderer.send('dock-menu', index, groupKey),
  runningMenu: (key) => ipcRenderer.send('running-menu', key),
  winActivate: (hwnds) => ipcRenderer.send('win-activate', hwnds),
  winClose: (hwnds) => ipcRenderer.send('win-close', hwnds),
  pin: (key) => ipcRenderer.send('dock-pin', key),
  winPreviews: (hwnds) => ipcRenderer.invoke('win-previews', hwnds),
  addPaths: (paths) => ipcRenderer.send('dock-add', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  reorder: (from, to) => ipcRenderer.send('dock-reorder', from, to),
  icon: (item) => ipcRenderer.invoke('icon', item),
  appsList: (refresh) => ipcRenderer.invoke('apps-list', refresh),
  setDockItems: (items) => ipcRenderer.invoke('dock-set-items', items),
  setDockOptions: (opts) => ipcRenderer.invoke('dock-set-options', opts),
  browseApps: () => ipcRenderer.invoke('browse-apps'),
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  setFocusable: (v) => ipcRenderer.send('set-focusable', v),
  media: (cmd) => ipcRenderer.send('media', cmd),
  controls: (req) => ipcRenderer.invoke('controls', req),
  notifOpen: (id) => ipcRenderer.send('notif-open', id),
  notifDismiss: (ids) => ipcRenderer.send('notif-dismiss', ids),
  action: (index) => ipcRenderer.send('action', index),
  openSettings: (uri) => ipcRenderer.send('open-settings', uri),
  on: (channel, cb) => {
    if (!CHANNELS.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
