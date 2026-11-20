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
  let itemEls = [];
  let hideTimer = null;
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
    d.items.forEach((item, i) => {
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
    updateRunning();
    requestAnimationFrame(ui.syncGlass);
  }

  function updateRunning() {
    for (const el of itemEls) {
      const p = procName(el._item);
      el.classList.toggle('running', !!p && running.has(p));
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
    if (el) showTip(el);
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

  // ----- launch & menus -----
  itemsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    const idx = Number(el.dataset.index);
    if (!el.classList.contains('running')) {
      el.classList.remove('bounce');
      void el.offsetWidth;
      el.classList.add('bounce');
      setTimeout(() => el.classList.remove('bounce'), 1900);
    }
    frost.launch(idx);
  });

  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('[data-index]');
    tip.classList.remove('show');
    frost.dockMenu(el ? Number(el.dataset.index) : -1);
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

  frost.on('running', (list) => {
    running = new Set(list.map((n) => n.toLowerCase()));
    updateRunning();
  });

  render();
})();
