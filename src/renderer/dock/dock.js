(async function () {
  const ui = window.FrostUI;
  const $ = (s) => document.querySelector(s);
  const wrap = $('#dock-wrap');
  const itemsEl = $('#items');
  const tip = $('#tip');
  const hot = $('#hot');

  const init = await frost.init();
  let cfg = init.config;
  let running = new Set((init.running || []).map((n) => n.toLowerCase()));
  let groups = init.windows || []; // open app windows, grouped per app (from main)
  let extrasSig = '';
  let itemEls = [];
  let hideTimer = null;
  let prevExtras = new Set(groups.map((g) => g.key));
  let dragFrom = -1;

  ui.glassify($('#dock-bg'));
  ui.boot(init, {
    onConfig: (p) => {
      cfg = p.config;
      render();
    },
  });

  function procName(item) {
    if (item.process === false) return null;
    if (item.process) return item.process.toLowerCase();
    const m = (item.path || '').match(/([^\\/]+\.exe)$/i);
    return m ? m[1].toLowerCase() : null;
  }

  // Always the real Windows icon (resolved by the main process); the square plate
  // behind it is what makes every icon look uniform.
  const lc = (v) => String(v || '').toLowerCase();
  const exeOf = (p) => ((p || '').match(/([^\\/]+\.exe)$/i) || [])[1];

  // which open-window group belongs to a pinned dock item?
  function groupFor(item) {
    if (!item || item.type === 'separator') return null;
    const aumid = ((item.path || '').match(/^shell:AppsFolder\\(.+)$/i) || [])[1];
    const exes = [typeof item.process === 'string' ? item.process : null, exeOf(item.path)].filter(Boolean).map(lc);
    return (
      groups.find((g) => (aumid && lc(g.aumid) === lc(aumid)) || (g.exe && exes.includes(lc(g.exe)))) || null
    );
  }

  // running apps that aren't pinned: shown before the first separator, like macOS
  function extraGroups() {
    if (cfg.dock.showRunning === false) return [];
    const taken = new Set(cfg.dock.items.map(groupFor).filter(Boolean).map((g) => g.key));
    return groups.filter((g) => !taken.has(g.key));
  }

  async function setIcon(tile, item) {
    let url = null;
    try {
      url = await frost.icon(item);
    } catch {}
    if (!url) return; // keep the neutral placeholder
    const img = new Image();
    img.draggable = false;
    img.alt = '';
    img.onload = () => tile.classList.remove('loading');
    img.src = url;
    tile.replaceChildren(img);
  }

  function render() {
    const d = cfg.dock;
    document.documentElement.style.setProperty('--icon', `${d.iconSize}px`);
    document.documentElement.style.setProperty('--margin', `${d.margin}px`);
    document.body.classList.toggle('autohide', !!d.autoHide);
    document.body.classList.toggle('icons-plain', d.iconStyle === 'plain');
    hot.toggleAttribute('data-hit', !!d.autoHide);
    if (d.autoHide) document.body.classList.add('hidden');
    else document.body.classList.remove('hidden');

    itemsEl.replaceChildren();
    itemEls = [];
    const extras = extraGroups();
    extrasSig = extras.map((g) => g.key).join('|');
    const firstSep = d.items.findIndex((i) => i.type === 'separator');
    const addExtras = () => {
      if (extras.length && itemsEl.querySelector('.item')) {
        const div = document.createElement('div');
        div.className = 'sep auto'; // pinned | open-but-not-pinned
        itemsEl.append(div);
      }
      for (const g of extras) {
        const el = document.createElement('div');
        el.className = 'item running extra' + (prevExtras.has(g.key) ? '' : ' appear');
        el.dataset.extra = g.key;
        const tile = document.createElement('div');
        tile.className = 'tile loading';
        tile.innerHTML = Icons.placeholder;
        el.append(tile);
        setIcon(tile, { path: g.aumid ? `shell:AppsFolder\\${g.aumid}` : g.path });
        el._item = { name: g.name || g.exe || 'App' };
        el._group = g;
        itemsEl.append(el);
        itemEls.push(el);
      }
      prevExtras = new Set(extras.map((g) => g.key));
    };
    d.items.forEach((item, i) => {
      if (i === firstSep) addExtras();
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'sep';
        sep.dataset.index = i;
        itemsEl.append(sep);
        return;
      }
      const el = document.createElement('div');
      el.className = 'item';
      el.dataset.index = i;
      el.draggable = true;
      const tile = document.createElement('div');
      tile.className = 'tile loading';
      tile.innerHTML = Icons.placeholder;
      el.append(tile);
      setIcon(tile, item);
      el._item = item;
      itemsEl.append(el);
      itemEls.push(el);
    });
    if (firstSep < 0) addExtras();
    updateRunning();
    requestAnimationFrame(ui.syncGlass);
  }

  function updateRunning() {
    for (const el of itemEls) {
      if (el._group) continue; // extras are running by definition
      const p = procName(el._item);
      const g = groupFor(el._item);
      el._running = g;
      el.classList.toggle('running', !!g || (!!p && running.has(p)));
    }
  }

  // ----- magnification -----
  function magnify(x) {
    const d = cfg.dock;
    const range = d.iconSize * 2.6;
    const extra = Math.max(0, d.magnification - 1);
    for (const el of itemEls) {
      const r = el.getBoundingClientRect();
      const dist = Math.abs(x - (r.left + r.width / 2));
      const t = Math.max(0, 1 - dist / range);
      const s = 1 + extra * (0.5 - Math.cos(t * Math.PI) / 2);
      el.style.setProperty('--s', s.toFixed(3));
    }
  }
  function resetMagnify() {
    for (const el of itemEls) el.style.setProperty('--s', 1);
  }

  function showTip(el) {
    const r = el.getBoundingClientRect();
    tip.textContent = el._item.name;
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top = `${r.top - 38}px`;
    tip.classList.add('show');
  }

  wrap.addEventListener('mousemove', (e) => {
    if (dragFrom >= 0) return;
    document.body.classList.add('magnifying');
    magnify(e.clientX);
    const el = e.target.closest('.item');
    if (el && !(pv.el === el && preview.classList.contains('show'))) showTip(el);
    else tip.classList.remove('show');
    ui.kick();
  });

  wrap.addEventListener('mouseleave', () => {
    document.body.classList.remove('magnifying');
    resetMagnify();
    tip.classList.remove('show');
    if (cfg.dock.autoHide) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => document.body.classList.add('hidden'), 700);
    }
  });

  wrap.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  hot.addEventListener('mouseenter', () => {
    if (!cfg.dock.autoHide) return;
    clearTimeout(hideTimer);
    document.body.classList.remove('hidden');
  });

  // ----- hover window previews -----
  const preview = $('#preview');
  ui.glassify(preview);
  const pv = { el: null, timer: null, hideTimer: null, refresh: null, overPreview: false, seq: 0 };
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  const groupOf = (el) => (el ? el._group || el._running || null : null);

  function iconUrlOf(el) {
    const img = el && el.querySelector('.tile img');
    return img ? img.src : '';
  }

  async function loadPreview(el, first) {
    const g = groupOf(el);
    if (!g) return hidePreview(true);
    const seq = ++pv.seq;
    let shots = [];
    try {
      shots = (await frost.winPreviews(g.hwnds)) || [];
    } catch {}
    if (seq !== pv.seq || pv.el !== el) return; // hovered something else meanwhile
    if (!shots.length) return hidePreview(true);
    renderPreview(el, shots);
    if (first) {
      preview.classList.add('show');
      placePreview(el);
      requestAnimationFrame(() => preview.classList.add('in'));
    }
  }

  function renderPreview(el, shots) {
    const icon = iconUrlOf(el);
    const keepScroll = preview.scrollLeft;
    preview.replaceChildren();
    for (const s of shots) {
      const card = document.createElement('div');
      card.className = 'pv-card';
      card.innerHTML = `<div class="pv-head">${icon ? `<img src="${icon}" alt="">` : ''}<span class="pv-title"></span><button class="pv-x" title="Close window">${CLOSE}</button></div><div class="pv-thumb"></div>`;
      card.querySelector('.pv-title').textContent = s.title || el._item.name;
      const thumb = card.querySelector('.pv-thumb');
      if (s.image) {
        const img = new Image();
        img.src = s.image;
        img.alt = '';
        thumb.append(img);
      } else {
        thumb.innerHTML = `<div class="pv-min">${icon ? `<img src="${icon}" alt="">` : ''}<span>Minimized</span></div>`;
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pv-x')) {
          frost.winClose([s.hwnd]);
          card.remove();
          if (!preview.querySelector('.pv-card')) hidePreview(true);
          else placePreview(el);
          return;
        }
        frost.winActivate([s.hwnd]);
        hidePreview(true);
      });
      preview.append(card);
    }
    preview.scrollLeft = keepScroll;
  }

  function placePreview(el) {
    const r = el.getBoundingClientRect();
    const w = preview.offsetWidth;
    const x = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    preview.style.left = `${x}px`;
    preview.style.bottom = `${innerHeight - r.top + 12}px`;
    ui.syncGlass();
  }

  function showPreviewFor(el, immediate) {
    clearTimeout(pv.timer);
    clearTimeout(pv.hideTimer);
    if (pv.el === el && preview.classList.contains('show')) return;
    const open = preview.classList.contains('show');
    pv.timer = setTimeout(
      () => {
        pv.el = el;
        tip.classList.remove('show');
        loadPreview(el, !open).then(() => open && placePreview(el));
        clearInterval(pv.refresh);
        pv.refresh = setInterval(() => pv.el && loadPreview(pv.el, false), 1500); // keep thumbnails fresh
      },
      immediate || open ? 0 : 450
    );
  }

  function hidePreview(now) {
    clearTimeout(pv.timer);
    clearTimeout(pv.hideTimer);
    const go = () => {
      clearInterval(pv.refresh);
      pv.el = null;
      pv.seq++;
      preview.classList.remove('in');
      setTimeout(() => !pv.el && preview.classList.remove('show'), 180);
    };
    if (now) go();
    else pv.hideTimer = setTimeout(() => !pv.overPreview && go(), 260);
  }

  itemsEl.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.item');
    if (el && groupOf(el) && dragFrom < 0) showPreviewFor(el);
    else if (el) {
      clearTimeout(pv.timer);
      if (preview.classList.contains('show')) hidePreview(true);
    }
  });
  wrap.addEventListener('mouseleave', () => hidePreview(false));
  preview.addEventListener('mouseenter', () => {
    pv.overPreview = true;
    clearTimeout(pv.hideTimer);
  });
  preview.addEventListener('mouseleave', () => {
    pv.overPreview = false;
    hidePreview(false);
  });

  // ----- launch & menus -----
  itemsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    hidePreview(true);
    if (el._group) return frost.winActivate(el._group.hwnds);
    const idx = Number(el.dataset.index);
    if (el._running && !e.shiftKey) return frost.winActivate(el._running.hwnds); // bring it forward
    if (!el.classList.contains('running')) {
      el.classList.remove('bounce');
      void el.offsetWidth;
      el.classList.add('bounce');
      setTimeout(() => el.classList.remove('bounce'), 1900);
    }
    frost.launch(idx);
  });

  itemsEl.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const el = e.target.closest('.item');
    if (el && !el._group) frost.launch(Number(el.dataset.index)); // middle-click: new window
  });

  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tip.classList.remove('show');
    const extra = e.target.closest('[data-extra]');
    if (extra) return frost.runningMenu(extra.dataset.extra);
    const el = e.target.closest('[data-index]');
    const item = el && el.classList.contains('item') ? itemEls.find((x) => x === el) : null;
    frost.dockMenu(el ? Number(el.dataset.index) : -1, item && item._running ? item._running.key : undefined);
  });

  // ----- drag to reorder / drop files to pin -----
  itemsEl.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    dragFrom = Number(el.dataset.index);
    resetMagnify();
    tip.classList.remove('show');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-frost-index', String(dragFrom));
  });
  itemsEl.addEventListener('dragend', () => {
    dragFrom = -1;
    document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
  });

  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    const isFiles = e.dataTransfer.types.includes('Files');
    document.body.classList.toggle('drop-target', isFiles);
    document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    const el = e.target.closest('[data-index]');
    if (el && dragFrom >= 0) el.classList.add('drag-over');
  });
  wrap.addEventListener('dragleave', (e) => {
    if (!wrap.contains(e.relatedTarget)) document.body.classList.remove('drop-target');
  });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drop-target');
    if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => frost.pathForFile(f)).filter(Boolean);
      frost.addPaths(paths);
      return;
    }
    const el = e.target.closest('[data-index]');
    if (el && dragFrom >= 0) {
      const to = Number(el.dataset.index);
      if (to !== dragFrom) frost.reorder(dragFrom, to);
    }
    dragFrom = -1;
  });

  frost.on('windows', (list) => {
    groups = Array.isArray(list) ? list : [];
    const sig = extraGroups().map((g) => g.key).join('|');
    if (sig !== extrasSig) render(); // apps opened/closed -> dock grows/shrinks
    else {
      // same apps: just refresh window handles + dots
      for (const el of itemEls) if (el._group) el._group = groups.find((g) => g.key === el._group.key) || el._group;
      updateRunning();
    }
  });

  frost.on('running', (list) => {
    running = new Set(list.map((n) => n.toLowerCase()));
    updateRunning();
  });

  render();
})();
