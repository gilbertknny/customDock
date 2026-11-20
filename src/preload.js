// Minimal, explicit bridge between renderers and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = ['config', 'media', 'stats', 'running', 'wallpaper', 'geometry'];

contextBridge.exposeInMainWorld('frost', {
  init: () => ipcRenderer.invoke('init'),
  setIgnore: (ignore) => ipcRenderer.send('ignore', ignore),
  launch: (index) => ipcRenderer.send('launch', index),
  dockMenu: (index) => ipcRenderer.send('dock-menu', index),
  addPaths: (paths) => ipcRenderer.send('dock-add', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  reorder: (from, to) => ipcRenderer.send('dock-reorder', from, to),
  icon: (item) => ipcRenderer.invoke('icon', item),
  media: (cmd) => ipcRenderer.send('media', cmd),
  action: (a) => ipcRenderer.send('action', a),
  on: (channel, cb) => {
    if (!CHANNELS.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
