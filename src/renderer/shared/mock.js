// Browser-only stand-in for the Electron bridge, so the renderers can be previewed
// in a normal browser (docs/preview.html, GitHub Pages). Does nothing inside Electron.
(function () {
  if (window.frost) return;
  const q = new URLSearchParams(location.search);
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);

  const sw = num('sw', 1920);
  const sh = num('sh', 1080);
  const kind = location.pathname.includes('/island/') ? 'island' : 'dock';
  const winW = kind === 'island' ? 620 : sw;
  const winH = kind === 'island' ? 320 : 193;
  const win = { x: num('x', kind === 'island' ? (sw - winW) / 2 : 0), y: num('y', kind === 'island' ? 0 : sh - winH), width: winW, height: winH };

  const config = {
    theme: q.get('theme') || 'dark',
    glass: { mode: 'wallpaper', blur: 26, saturation: 1.8, tint: 0.22, border: 0.28, noise: 0.05 },
    dock: {
      enabled: true,
      iconSize: 50,
      magnification: 1.65,
      autoHide: false,
      aboveTaskbar: true,
      margin: 10,
      items: [
        { name: 'File Explorer', icon: 'builtin:folder' },
        { name: 'Edge', path: 'msedge.exe' },
        { name: 'Terminal', icon: 'builtin:terminal', process: 'WindowsTerminal.exe' },
        { name: 'Spotify', path: 'Spotify.exe' },
        { name: 'VS Code', path: 'Code.exe' },
        { name: 'Calculator', icon: 'builtin:calculator' },
        { name: 'Settings', icon: 'builtin:settings' },
        { type: 'separator' },
        { name: 'Recycle Bin', icon: 'builtin:trash', process: false },
      ],
    },
    island: {
      enabled: true,
      style: q.get('style') || 'glass',
      clock24h: true,
      showSeconds: false,
      expandOnHover: true,
      activityDuration: 3500,
      quickActions: [
        { label: 'Snip', icon: 'scissors' },
        { label: 'Timer 5m', icon: 'timer', action: 'timer', minutes: 5 },
        { label: 'Lock', icon: 'lock' },
        { label: 'Settings', icon: 'gear' },
      ],
    },
  };

  const art =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".5" stop-color="#8b7bff"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="24" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5"/><circle cx="50" cy="50" r="6" fill="#fff"/></svg>'
    );
  let media = { active: true, key: 'a', title: 'Glass Horizons', artist: 'Aurora Lane', app: 'Spotify', playing: true, position: 74, duration: 214, art };

  window.frost = {
    init: async () => ({
      kind,
      demo: true,
      config,
      theme: config.theme,
      display: { x: 0, y: 0, width: sw, height: sh },
      window: win,
      wallpaper: q.get('wallpaper') || '../../../assets/demo-wallpaper.jpg',
      media,
      stats: { cpu: 0.23, mem: 0.58 },
      running: ['msedge.exe', 'windowsterminal.exe', 'spotify.exe'],
    }),
    setIgnore: () => {},
    launch: (i) => console.log('[mock] launch', i),
    dockMenu: (i) => console.log('[mock] menu', i),
    addPaths: (p) => console.log('[mock] add', p),
    pathForFile: (f) => f.name,
    reorder: (a, b) => {
      const it = config.dock.items.splice(a, 1)[0];
      config.dock.items.splice(b, 0, it);
      emit('config', { config, theme: config.theme });
    },
    icon: async () => null,
    media: (cmd) => {
      if (cmd === 'toggle') media = { ...media, playing: !media.playing };
      else media = { ...media, key: String(Math.random()), title: cmd === 'next' ? 'Midnight Frost' : 'Soft Focus', artist: 'Neon Drift', position: 0 };
      emit('media', media);
    },
    action: (a) => console.log('[mock] action', a),
    on: (ch, cb) => {
      (listeners[ch] = listeners[ch] || []).push(cb);
      return () => {};
    },
  };

  setInterval(() => emit('stats', { cpu: 0.15 + Math.random() * 0.3, mem: 0.55 + Math.random() * 0.05 }), 2000);
})();
