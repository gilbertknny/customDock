// Shared renderer runtime: theme, glass alignment, click-through hit testing.
(function () {
  const root = document.documentElement;
  const geo = { display: { x: 0, y: 0, width: screen.width, height: screen.height }, window: null };
  const glassEls = new Set();
  let ignoring = true;
  let animating = 0;
  let rafId = 0;

  function applyConfig({ config, theme }) {
    const g = config.glass || {};
    root.style.setProperty('--blur', `${g.blur ?? 26}px`);
    root.style.setProperty('--sat', g.saturation ?? 1.8);
    root.style.setProperty('--tint', g.tint ?? 0.22);
    root.style.setProperty('--border', g.border ?? 0.28);
    root.style.setProperty('--noise', g.noise ?? 0.05);
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme !== 'dark');
    document.body.classList.toggle('glass-tint', g.mode === 'tint');
  }

  function setWallpaper(url) {
    document.body.classList.toggle('no-wallpaper', !url);
    root.style.setProperty('--wallpaper', url ? `url("${url}")` : 'none');
  }

  function setGeometry(g) {
    if (g.display) geo.display = g.display;
    if (g.window) geo.window = g.window;
    root.style.setProperty('--sw', `${geo.display.width}px`);
    root.style.setProperty('--sh', `${geo.display.height}px`);
    syncGlass();
  }

  // Align each glass element's wallpaper copy with the real desktop underneath it.
  function syncGlass() {
    const win = geo.window || { x: window.screenX, y: window.screenY };
    const offX = win.x - geo.display.x;
    const offY = win.y - geo.display.y;
    for (const el of glassEls) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--bgx', `${-(offX + r.left)}px`);
      el.style.setProperty('--bgy', `${-(offY + r.top)}px`);
    }
  }

  function loop() {
    syncGlass();
    rafId = animating > 0 ? requestAnimationFrame(loop) : 0;
  }
  function kick() {
    if (!rafId) rafId = requestAnimationFrame(loop);
  }
  document.addEventListener('transitionrun', () => {
    animating++;
    kick();
  });
  const done = () => {
    animating = Math.max(0, animating - 1);
    syncGlass();
  };
  document.addEventListener('transitionend', done);
  document.addEventListener('transitioncancel', done);
  // safety net: never let a missed transitionend keep the loop alive forever
  setInterval(() => {
    if (animating && !document.querySelector(':hover')) animating = 0;
  }, 3000);

  const ro = new ResizeObserver(syncGlass);
  window.addEventListener('resize', syncGlass);

  function glassify(el) {
    if (!el.querySelector(':scope > .glass-wall')) {
      const wall = document.createElement('div');
      wall.className = 'glass-wall';
      const frost = document.createElement('div');
      frost.className = 'glass-frost';
      el.prepend(wall, frost);
    }
    glassEls.add(el);
    ro.observe(el);
    syncGlass();
    return el;
  }

  // Transparent pixels pass clicks to the desktop; anything marked [data-hit] catches them.
  function setIgnore(next) {
    if (next === ignoring) return;
    ignoring = next;
    window.frost.setIgnore(next);
  }
  document.addEventListener('mousemove', (e) => {
    setIgnore(!(e.target instanceof Element && e.target.closest('[data-hit]')));
  });
  document.addEventListener('mouseleave', () => setIgnore(true));

  function boot(init, { onConfig } = {}) {
    applyConfig(init);
    setWallpaper(init.wallpaper);
    setGeometry(init);
    window.frost.on('config', (p) => {
      applyConfig(p);
      onConfig && onConfig(p);
    });
    window.frost.on('wallpaper', setWallpaper);
    window.frost.on('geometry', setGeometry);
  }

  window.FrostUI = { boot, glassify, syncGlass, kick };
})();
