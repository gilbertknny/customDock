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
  const kind = location.pathname.includes('/notch/') ? 'notch' : 'dock';
  const winW = kind === 'notch' ? 640 : sw;
  const winH = kind === 'notch' ? 560 : 193;
  const win = { x: num('x', kind === 'notch' ? (sw - winW) / 2 : 0), y: num('y', kind === 'notch' ? 0 : sh - winH), width: winW, height: winH };

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
      iconStyle: q.get('icons') || 'square',
      items: [
        { name: 'File Explorer', path: 'folder', process: false },
        { name: 'Browser', path: 'globe' },
        { name: 'Terminal', path: 'terminal', process: 'terminal' },
        { name: 'Music', path: 'music', process: 'music' },
        { name: 'Code', path: 'code' },
        { name: 'Notepad', path: 'note' },
        { name: 'Calculator', path: 'calc' },
        { name: 'Settings', path: 'gear' },
        { type: 'separator' },
        { name: 'Recycle Bin', path: 'bin', process: false },
      ],
    },
    notch: {
      enabled: true,
      style: q.get('style') || 'glass',
      idleScale: 0.75,
      osd: true,
      notifications: { enabled: true, popup: true, duration: 6000, max: 50 },
      proximity: 240,
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

  // Stand-ins for real Windows icons (mixed shapes on purpose, to show the uniform plate).
  const SAMPLE = {
    folder: '<path d="M8 22a5 5 0 0 1 5-5h20l6 6h28a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill="#f4b73f"/><path d="M8 32h64v32a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill="#ffd25c"/>',
    globe: '<circle cx="40" cy="40" r="30" fill="#2f8cf0"/><path d="M10 40h60M40 10c-12 14-12 46 0 60M40 10c12 14 12 46 0 60" stroke="#bfe0ff" stroke-width="3" fill="none"/>',
    terminal: '<rect x="8" y="14" width="64" height="52" rx="7" fill="#1e2129"/><rect x="8" y="14" width="64" height="10" rx="5" fill="#3a3f4b"/><path d="M20 36l9 7-9 7" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M34 52h14" stroke="#5ce39c" stroke-width="4" stroke-linecap="round"/>',
    music: '<circle cx="40" cy="40" r="30" fill="#e8436b"/><path d="M33 52V27l20-5v25" stroke="#fff" stroke-width="4" fill="none"/><circle cx="29" cy="52" r="5" fill="#fff"/><circle cx="49" cy="47" r="5" fill="#fff"/>',
    code: '<path d="M14 18l40-8 14 10v40l-14 10-40-8z" fill="#2c7be5"/><path d="M34 30l-8 10 8 10M46 30l8 10-8 10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>',
    note: '<path d="M18 8h32l14 14v50H18z" fill="#fff" stroke="#9aa3b2" stroke-width="2"/><path d="M50 8v14h14" fill="#dfe4ec"/><path d="M26 36h30M26 46h30M26 56h20" stroke="#5a8dee" stroke-width="3"/>',
    calc: '<rect x="18" y="8" width="44" height="64" rx="7" fill="#3b3f4a"/><rect x="24" y="14" width="32" height="12" rx="3" fill="#a8e6cf"/><g fill="#d9dce3"><rect x="24" y="32" width="8" height="8" rx="2"/><rect x="36" y="32" width="8" height="8" rx="2"/><rect x="24" y="44" width="8" height="8" rx="2"/><rect x="36" y="44" width="8" height="8" rx="2"/><rect x="24" y="56" width="8" height="8" rx="2"/><rect x="36" y="56" width="8" height="8" rx="2"/></g><rect x="48" y="32" width="8" height="32" rx="2" fill="#ff8c42"/>',
    gear: '<g transform="translate(40 40)" fill="#7b8494">' + Array.from({ length: 8 }, (_, i) => `<rect x="-5" y="-31" width="10" height="14" rx="3" transform="rotate(${i * 45})"/>`).join('') + '<circle r="21"/></g><circle cx="40" cy="40" r="9" fill="#e9ecf2"/>',
    Messages: '<rect x="8" y="12" width="64" height="46" rx="14" fill="#34c759"/><path d="M24 56l-6 14 18-12z" fill="#34c759"/><circle cx="28" cy="35" r="4" fill="#fff"/><circle cx="40" cy="35" r="4" fill="#fff"/><circle cx="52" cy="35" r="4" fill="#fff"/>',
    Mail: '<rect x="8" y="16" width="64" height="48" rx="8" fill="#1a82f7"/><path d="M10 20l30 22 30-22" stroke="#fff" stroke-width="4" fill="none"/>',
    Calendar: '<rect x="12" y="14" width="56" height="54" rx="9" fill="#fff" stroke="#d0d5dd" stroke-width="2"/><path d="M12 23a9 9 0 0 1 9-9h38a9 9 0 0 1 9 9v7H12z" fill="#ef4444"/><text x="40" y="60" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="26" font-weight="700" fill="#222">20</text>',
    Downloads: '<circle cx="40" cy="40" r="30" fill="#6366f1"/><path d="M40 24v26M29 40l11 11 11-11M27 58h26" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    bin: '<path d="M22 24h36l-3 44a5 5 0 0 1-5 4H30a5 5 0 0 1-5-4z" fill="#dfe8f5" stroke="#8fa3c0" stroke-width="2"/><rect x="17" y="16" width="46" height="8" rx="3" fill="#8fa3c0"/>',
  };
  const sampleIcon = (k) =>
    SAMPLE[k] ? 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${SAMPLE[k]}</svg>`) : null;

  const ccState = { volume: 0.62, muted: false, brightness: 70, wifi: true, bluetooth: true, airplane: false, ssid: 'Rumah_5G', signal: 82, ethernet: false, lowPower: false, dnd: true };

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
      running: ['globe', 'terminal', 'music'],
      notifications: [
        { id: 'n1', app: 'Mail', appName: 'Mail', time: Date.now() - 42 * 60e3, title: 'Invoice #2291 paid', body: 'Payment received. Thanks for your business!' },
        { id: 'n2', app: 'Calendar', appName: 'Calendar', time: Date.now() - 3 * 3600e3, title: 'Design review in 10 min', body: 'Room 4B · with Dimas, Sarah' },
        { id: 'n3', app: 'Messages', appName: 'Messages', time: Date.now() - 5 * 3600e3, title: 'Rani', body: 'Jadi meeting jam 3 ya? Aku bawa laptop 👍' },
        { id: 'n4', app: 'Downloads', appName: 'Downloads', time: Date.now() - 26 * 3600e3, title: 'Download complete', body: 'frostshell-setup-0.2.0.exe (84 MB)' },
      ],
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
    icon: async (item) => sampleIcon(String(item.path || '').replace(/^shell:AppsFolder\\/, '')),
    media: (cmd) => {
      if (cmd === 'toggle') media = { ...media, playing: !media.playing };
      else media = { ...media, key: String(Math.random()), title: cmd === 'next' ? 'Midnight Frost' : 'Soft Focus', artist: 'Neon Drift', position: 0 };
      emit('media', media);
    },
    action: (i) => console.log('[mock] action', i),
    openSettings: (u) => console.log('[mock] settings', u),
    notifOpen: (n) => console.log('[mock] open', n),
    notifDismiss: (ids) => console.log('[mock] dismiss', ids),
    controls: async (req) => {
      const c = ccState;
      if (req.cmd === 'setVolume') (c.volume = req.value), (c.muted = false);
      if (req.cmd === 'setMute') c.muted = !!req.value;
      if (req.cmd === 'setBrightness') c.brightness = req.value;
      if (req.cmd === 'setRadio') c[req.kind === 'WiFi' ? 'wifi' : 'bluetooth'] = !!req.on;
      if (req.cmd === 'setAirplane') (c.airplane = !!req.on), (c.wifi = !req.on), (c.bluetooth = !req.on);
      if (req.cmd === 'setLowPower') c.lowPower = !!req.on;
      if (req.cmd === 'setDnd') c.dnd = !!req.on;
      c.ssid = c.wifi ? 'Rumah_5G' : null;
      return { ok: true, state: { ...c } };
    },
    on: (ch, cb) => {
      (listeners[ch] = listeners[ch] || []).push(cb);
      return () => {};
    },
  };

  setInterval(() => emit('stats', { cpu: 0.15 + Math.random() * 0.3, mem: 0.55 + Math.random() * 0.05 }), 2000);
})();
