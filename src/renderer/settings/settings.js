(async function () {
  const $ = (s) => document.querySelector(s);
  const init = await frost.init();
  let cfg = init.config;
  let items = clone(cfg.dock.items);
  let apps = [];
  let dragFrom = -1;

  function clone(v) {
    return JSON.parse(JSON.stringify(v || []));
  }

  // ---------- theme ----------
  function applyTheme(theme) {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme !== 'dark');
  }
  applyTheme(init.theme);
  document.body.classList.toggle('mica', init.platform === 'win32');

  const svg = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON_APP = svg('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9h16"/>');
  $('[data-nav="apps"] .ni').innerHTML = svg('<rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 14V9M12 14V6M17 14V10"/>');
  $('[data-nav="look"] .ni').innerHTML = svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>');
  $('.search .si').innerHTML = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>');

  // ---------- helpers ----------
  const iconCache = new Map();
  function setIcon(box, item) {
    box.innerHTML = ICON_APP;
    const key = JSON.stringify([item.icon || '', item.path || '', item.args || []]);
    if (!iconCache.has(key)) iconCache.set(key, frost.icon(item).catch(() => null));
    iconCache.get(key).then((url) => {
      if (!url) return;
      const img = new Image();
      img.alt = '';
      img.src = url;
      box.replaceChildren(img);
    });
  }

  function describe(item) {
    const p = item.path || '';
    if (/^shell:AppsFolder\\/i.test(p)) return item.process ? 'Desktop app' : 'App';
    if (/^shell:/i.test(p)) return 'Windows folder';
    if (/^[a-z][a-z0-9+.-]+:/i.test(p) && !/^[a-z]:\\/i.test(p)) return p;
    return p;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  const norm = (s) => String(s || '').toLowerCase();
  function inDock(app) {
    const path = `shell:appsfolder\\${norm(app.id)}`;
    return items.some((i) => i.type !== 'separator' && (norm(i.path) === path || norm(i.name) === norm(app.name)));
  }

  async function save() {
    await frost.setDockItems(items);
  }

  // ---------- "In your dock" ----------
  function renderDock(flashIndex = -1) {
    const list = $('#dock-list');
    list.replaceChildren();
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.index = i;
      if (item.type === 'separator') {
        li.className = 'sep';
        li.innerHTML = '<span class="grip">⠿</span><span class="line"></span><button class="x" title="Remove">✕</button>';
      } else {
        li.innerHTML = '<span class="grip">⠿</span><span class="ic"></span><span class="nm"><b></b><small></small></span><button class="x" title="Remove from dock">✕</button>';
        li.querySelector('b').textContent = item.name;
        li.querySelector('small').textContent = describe(item);
        setIcon(li.querySelector('.ic'), item);
      }
      if (i === flashIndex) li.classList.add('flash');
      list.append(li);
    });
    $('#dock-count').textContent = `· ${items.filter((i) => i.type !== 'separator').length}`;
    renderApps(); // refresh "Added" states
  }

  $('#dock-list').addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    const i = Number(x.closest('li').dataset.index);
    const [removed] = items.splice(i, 1);
    renderDock();
    save();
    if (removed.type !== 'separator') toast(`Removed ${removed.name}`);
  });

  // drag to reorder
  const list = $('#dock-list');
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    dragFrom = Number(li.dataset.index);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });
  list.addEventListener('dragend', () => {
    dragFrom = -1;
    list.querySelectorAll('li').forEach((l) => l.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  list.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const li = e.target.closest('li');
    list.querySelectorAll('li').forEach((l) => l.classList.remove('drop-before', 'drop-after'));
    if (!li) return;
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target.closest('li');
    if (!li || dragFrom < 0) return;
    let to = Number(li.dataset.index);
    if (li.classList.contains('drop-after')) to += 1;
    const [moved] = items.splice(dragFrom, 1);
    if (dragFrom < to) to -= 1;
    items.splice(to, 0, moved);
    dragFrom = -1;
    renderDock(to);
    save();
  });

  $('#add-sep').addEventListener('click', () => {
    items.push({ type: 'separator' });
    renderDock(items.length - 1);
    save();
  });

  function addItems(newItems) {
    if (!newItems.length) return;
    // new apps go before the first separator (folders / Recycle Bin stay at the end)
    const sep = items.findIndex((i) => i.type === 'separator');
    const at = sep >= 0 ? sep : items.length;
    items.splice(at, 0, ...newItems);
    renderDock(at);
    save();
    toast(newItems.length === 1 ? `Added ${newItems[0].name}` : `Added ${newItems.length} apps`);
    const row = $(`#dock-list li[data-index="${at}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- "Add apps" ----------
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const li = en.target;
        io.unobserve(li);
        setIcon(li.querySelector('.ic'), { path: `shell:AppsFolder\\${li.dataset.id}` });
      }
    },
    { root: $('#app-list'), rootMargin: '120px' }
  );

  function renderApps() {
    const q = norm($('#search').value).trim();
    const box = $('#app-list');
    const shown = apps.filter((a) => !q || norm(a.name).includes(q));
    box.replaceChildren();
    for (const a of shown) {
      const li = document.createElement('li');
      li.dataset.id = a.id;
      li.innerHTML = '<span class="ic"></span><span class="nm"><b></b><small></small></span><button class="btn small"></button>';
      li.querySelector('.ic').innerHTML = ICON_APP;
      li.querySelector('b').textContent = a.name;
      li.querySelector('small').textContent = a.exe || (a.id.includes('!') ? 'Microsoft Store app' : 'App');
      const btn = li.querySelector('button');
      const added = inDock(a);
      btn.textContent = added ? 'Added' : 'Add';
      btn.classList.toggle('added', added);
      btn.addEventListener('click', () => {
        if (inDock(a)) return;
        const item = { name: a.name, path: `shell:AppsFolder\\${a.id}` };
        if (a.exe) item.process = a.exe;
        addItems([item]);
      });
      box.append(li);
      io.observe(li);
    }
    const empty = $('#apps-empty');
    empty.textContent = apps.length ? 'No apps match your search' : 'Loading installed apps…';
    empty.classList.toggle('on', !shown.length);
  }

  async function loadApps(refresh = false) {
    apps = [];
    renderApps();
    try {
      apps = (await frost.appsList(refresh)) || [];
    } catch {
      apps = [];
    }
    if (!apps.length) $('#apps-empty').textContent = 'Could not read installed apps. Use Browse… instead.';
    renderApps();
  }

  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderApps, 80);
  });
  $('#refresh').addEventListener('click', () => loadApps(true));
  $('#browse').addEventListener('click', async () => addItems((await frost.browseApps()) || []));

  // ---------- appearance ----------
  const fmt = { iconSize: (v) => `${v}px`, magnification: (v) => `${Number(v).toFixed(2)}×` };
  let optTimer;
  function sendOptions(patch) {
    clearTimeout(optTimer);
    optTimer = setTimeout(() => frost.setDockOptions(patch), 120);
  }
  for (const id of ['iconSize', 'magnification']) {
    const el = $(`#${id}`);
    el.addEventListener('input', () => {
      $(`#${id}-v`).textContent = fmt[id](el.value);
      sendOptions({ [id]: Number(el.value) });
    });
  }
  for (const id of ['autoHide', 'hideTaskbar', 'aboveTaskbar']) {
    $(`#${id}`).addEventListener('change', (e) => frost.setDockOptions({ [id]: e.target.checked }));
  }
  $('#iconStyle').addEventListener('change', (e) => frost.setDockOptions({ iconStyle: e.target.checked ? 'square' : 'plain' }));

  function renderOptions() {
    const d = cfg.dock;
    $('#iconSize').value = d.iconSize;
    $('#iconSize-v').textContent = fmt.iconSize(d.iconSize);
    $('#magnification').value = d.magnification;
    $('#magnification-v').textContent = fmt.magnification(d.magnification);
    $('#iconStyle').checked = d.iconStyle !== 'plain';
    $('#autoHide').checked = !!d.autoHide;
    $('#hideTaskbar').checked = !!d.hideTaskbar;
    $('#aboveTaskbar').checked = d.aboveTaskbar !== false;
    $('#row-above').classList.toggle('disabled', !!d.hideTaskbar || !!d.autoHide);
  }

  // ---------- sidebar nav ----------
  const main = $('main');
  document.querySelectorAll('[data-nav]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.nav).scrollIntoView({ behavior: 'smooth' });
    })
  );
  main.addEventListener('scroll', () => {
    const look = document.getElementById('look').offsetTop - 120;
    const cur = main.scrollTop >= look ? 'look' : 'apps';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === cur));
  });

  // ---------- live sync (dock edited elsewhere, e.g. drag on the dock itself) ----------
  frost.on('config', (p) => {
    cfg = p.config;
    applyTheme(p.theme);
    if (JSON.stringify(cfg.dock.items) !== JSON.stringify(items) && dragFrom < 0) {
      items = clone(cfg.dock.items);
      renderDock();
    }
    renderOptions();
  });

  renderOptions();
  renderDock();
  loadApps();
})();
