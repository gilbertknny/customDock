(async function () {
  const ui = window.FrostUI;
  const $ = (s) => document.querySelector(s);
  const island = $('#notch'); // owns state + size (name kept for brevity)
  const panel = $('#panel'); // glass body incl. ears
  const rimPath = $('.rim path');

  const init = await frost.init();
  let cfg = init.config;
  let media = init.media || { active: false };
  let mediaAt = Date.now();
  let hover = false;
  let pinned = false;
  let activity = null;
  let activityTimer = null;
  let hoverTimer = null;
  let timer = null; // { end, minutes }
  let battery = null;
  let state = 'compact';
  let osd = null; // { kind, value, muted } while the volume/brightness OSD is up
  let osdTimer = null;

  ui.glassify(panel);
  ui.boot(init, {
    onConfig: (p) => {
      cfg = p.config;
      applyStyle();
      renderActions();
      renderList();
      tick();
    },
  });

  // ---------- notch outline (square top, concave ears, rounded bottom) ----------
  let lastShape = '';
  function drawShape() {
    const W = panel.offsetWidth;
    const H = panel.offsetHeight;
    if (!W || !H) return;
    const cs = getComputedStyle(island);
    const e = parseFloat(cs.getPropertyValue('--ear')) || 0;
    const r = Math.max(0, Math.min(parseFloat(cs.getPropertyValue('--r')) || 0, H - e, (W - 2 * e) / 2));
    const f = (n) => Math.round(n * 10) / 10;
    const outline =
      `M${f(W)} 0A${f(e)} ${f(e)} 0 0 0 ${f(W - e)} ${f(e)}V${f(H - r)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${f(W - e - r)} ${f(H)}H${f(e + r)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${f(e)} ${f(H - r)}V${f(e)}A${f(e)} ${f(e)} 0 0 0 0 0`;
    if (outline === lastShape) return;
    lastShape = outline;
    rimPath.setAttribute('d', outline); // open path: no rim line along the screen edge
    rimPath.parentNode.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><path d='M0 0H${f(W)}${outline.slice(outline.indexOf('A'))}Z'/></svg>`;
    panel.style.setProperty('--shape', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  new ResizeObserver(drawShape).observe(panel);
  let shapeRuns = 0;
  let shapeRaf = 0;
  const shapeLoop = () => {
    drawShape();
    shapeRaf = shapeRuns > 0 ? requestAnimationFrame(shapeLoop) : 0;
  };
  island.addEventListener('transitionrun', (e) => {
    if (e.target !== island) return;
    shapeRuns++;
    if (!shapeRaf) shapeRaf = requestAnimationFrame(shapeLoop);
  });
  const shapeDone = (e) => {
    if (e.target !== island) return;
    shapeRuns = Math.max(0, shapeRuns - 1);
    drawShape();
  };
  island.addEventListener('transitionend', shapeDone);
  island.addEventListener('transitioncancel', shapeDone);

  // ---------- state machine ----------
  function setState() {
    const expand = (hover && cfg.notch.expandOnHover) || pinned;
    const s = notif.current ? 'toast' : expand ? 'expanded' : osd ? 'osd' : activity ? 'activity' : 'compact';
    const entering = s !== state;
    state = s;
    island.classList.remove('s-compact', 's-activity', 's-toast', 's-expanded');
    island.classList.add(`s-${s}`);
    if (s !== 'compact') setK(1, false);
    else setK(restK(), false);
    if (s === 'expanded') {
      startCcPolling();
      if (entering) selectTab(notif.unread.size ? 'notifs' : currentTab === 'notifs' ? 'home' : currentTab);
    } else {
      stopCcPolling();
      if (typeof closeWifi === 'function') closeWifi();
      if (typeof closeBt === 'function') closeBt();
    }
    ui.kick();
    drawShape();
  }

  // ---------- idle size + proximity growth ----------
  // At rest the notch shrinks to notch.idleScale; it grows smoothly as the cursor
  // approaches (within notch.proximity px), then expands fully on hover.
  let k = 1;
  let trackTimer = null;
  const idleScale = () => Math.max(0.4, Math.min(1, cfg.notch.idleScale ?? 0.75));
  const restK = () => idleScale();

  function setK(next, tracking) {
    k = next;
    island.style.setProperty('--k', k.toFixed(3));
    if (tracking) {
      island.classList.add('tracking');
      clearTimeout(trackTimer);
      trackTimer = setTimeout(() => island.classList.remove('tracking'), 200);
    }
  }

  document.addEventListener('mousemove', (e) => {
    if (state !== 'compact') return;
    const idle = idleScale();
    if (idle >= 1) return;
    const range = cfg.notch.proximity ?? 240;
    // distance to the full-size notch (fixed geometry, so no feedback loop)
    const w = 200, h = 32;
    const left = innerWidth / 2 - w / 2;
    const dx = Math.max(left - e.clientX, 0, e.clientX - (left + w));
    const dy = Math.max(0, e.clientY - h);
    const t = Math.max(0, 1 - Math.hypot(dx, dy) / range);
    const ease = t * t * (3 - 2 * t);
    setK(idle + (1 - idle) * ease, true);
  });
  document.addEventListener('mouseleave', () => {
    if (state === 'compact') setK(restK(), true);
  });

  function applyStyle() {
    panel.classList.toggle('black', cfg.notch.style === 'black');
  }

  function showActivity(a, duration = cfg.notch.activityDuration || 3500) {
    activity = a;
    const icon = $('.a-icon');
    island.style.setProperty('--icon-color', a.color || '');
    island.style.setProperty('--pulse', a.color ? `${a.color}cc` : '');
    if (a.art) {
      const img = new Image();
      img.src = a.art;
      icon.replaceChildren(img);
    } else {
      icon.innerHTML = Icons.glyph(a.icon || 'music');
    }
    $('.a-sub').textContent = a.sub || '';
    $('.a-title').textContent = a.title || '';
    const right = $('.a-right');
    if (a.right === 'eq') right.innerHTML = '<div class="eq"><i></i><i></i><i></i><i></i></div>';
    else right.textContent = a.right || '';
    if (a.pulse) pulse(a.color);
    setState();
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      activity = null;
      setState();
    }, duration);
  }

  function pulse(color) {
    island.style.setProperty('--pulse', color ? `${color}cc` : '');
    island.classList.remove('pulse');
    void island.offsetWidth;
    island.classList.add('pulse');
    setTimeout(() => island.classList.remove('pulse'), 2300);
  }

  panel.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hover = true;
      setState();
    }, 90);
  });
  panel.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    if (typeof wifi !== 'undefined' && wifi.typing) return; // typing a Wi-Fi password: stay open
    hoverTimer = setTimeout(() => {
      hover = false;
      pinned = false;
      setState();
    }, 320);
  });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('button, .n-item, .toast')) return;
    if (!cfg.notch.expandOnHover) {
      pinned = !pinned;
      setState();
    }
  });

  // ---------- tabs ----------
  const TABS = ['home', 'controls', 'notifs'];
  let currentTab = 'home';
  function selectTab(name) {
    if (name !== 'controls' && typeof closeWifi === 'function') closeWifi();
    if (name !== 'controls' && typeof closeBt === 'function') closeBt();
    currentTab = name;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.dataset.page === name));
    $('.tabs').style.setProperty('--tab', TABS.indexOf(name));
    if (name === 'notifs') setTimeout(() => currentTab === 'notifs' && state === 'expanded' && markAllRead(), 900);
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  // ---------- clock ----------
  const fmt = (n) => String(n).padStart(2, '0');
  const mmss = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(sec / 60)}:${fmt(sec % 60)}`;
  };

  function timeString(withSeconds) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hour12: !cfg.notch.clock24h,
    }).format(new Date());
  }

  function tick() {
    $('.c-time').textContent = timeString(cfg.notch.showSeconds);
    $('.x-time').textContent = timeString(false);
    $('.x-date').textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());

    // timer
    const cTimer = $('.c-timer');
    if (timer) {
      const left = (timer.end - Date.now()) / 1000;
      if (left <= 0) {
        finishTimer();
      } else {
        cTimer.textContent = mmss(left);
      }
    }
    // interpolate media progress between bridge updates
    if (media.active && media.duration > 0) {
      const pos = Math.min(media.duration, media.position + (media.playing ? (Date.now() - mediaAt) / 1000 : 0));
      $('.progress').style.setProperty('--p', (pos / media.duration).toFixed(4));
      $('.t-pos').textContent = mmss(pos);
      $('.t-dur').textContent = mmss(media.duration);
    } else {
      $('.progress').style.setProperty('--p', 0);
      $('.t-pos').textContent = '';
      $('.t-dur').textContent = '';
    }
    updateCompactRight();
  }

  function updateCompactRight() {
    const showTimer = !!timer;
    const showEq = !showTimer && media.active && media.playing;
    const showBatt = !showTimer && !showEq && !!battery;
    $('.c-timer').classList.toggle('on', showTimer);
    $('.compact .eq').classList.toggle('on', showEq);
    $('.c-batt').classList.toggle('on', showBatt);
  }

  // ---------- media ----------
  function renderMedia(prevKey) {
    const active = !!media.active;
    island.classList.toggle('no-media', !active);
    island.classList.toggle('playing', active && !!media.playing);
    island.classList.toggle('has-art', active && !!media.art);
    if (media.art) {
      $('.art-sm').src = media.art;
      $('.art-lg img').src = media.art;
    }
    $('.m-title').textContent = active ? media.title || 'Unknown title' : 'Nothing playing';
    $('.m-artist').textContent = active ? media.artist || prettyApp(media.app) : 'Play something in Spotify, YouTube, etc.';
    $('[data-media="toggle"]').innerHTML = Icons.glyph(media.playing ? 'pause' : 'play');

    if (active && media.key && prevKey !== undefined && media.key !== prevKey && media.title) {
      showActivity({ art: media.art, sub: 'Now playing', title: `${media.title}${media.artist ? ' — ' + media.artist : ''}`, right: 'eq' });
    }
    tick();
  }

  function prettyApp(id = '') {
    const s = id.toLowerCase();
    if (s.includes('spotify')) return 'Spotify';
    if (s.includes('chrome')) return 'Google Chrome';
    if (s.includes('msedge')) return 'Microsoft Edge';
    if (s.includes('firefox')) return 'Firefox';
    if (s.includes('zune') || s.includes('media')) return 'Media Player';
    return id.split(/[\\!.]/).filter(Boolean).pop() || '';
  }

  document.querySelectorAll('[data-media]').forEach((btn) => {
    btn.innerHTML = Icons.glyph(btn.dataset.media === 'toggle' ? 'play' : btn.dataset.media);
    btn.addEventListener('click', () => frost.media(btn.dataset.media));
  });

  let lastKey;
  frost.on('media', (m) => {
    const prev = lastKey;
    media = m || { active: false };
    mediaAt = Date.now();
    lastKey = media.active ? media.key : null;
    renderMedia(prev);
  });

  // ---------- stats ----------
  function setRing(k, v, label) {
    const r = document.querySelector(`.ring[data-k="${k}"]`);
    r.style.setProperty('--v', Math.max(0, Math.min(1, v)).toFixed(3));
    r.querySelector('span').textContent = label;
  }
  function renderStats(s) {
    setRing('cpu', s.cpu, `${Math.round(s.cpu * 100)}`);
    setRing('mem', s.mem, `${Math.round(s.mem * 100)}`);
  }
  frost.on('stats', renderStats);
  renderStats(init.stats || { cpu: 0, mem: 0 });

  // ---------- battery ----------
  async function setupBattery() {
    if (!navigator.getBattery) return island.classList.add('no-battery');
    const b = await navigator.getBattery();
    // desktops report a permanently full, charging "battery"
    if (b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity) {
      island.classList.add('no-battery');
      return;
    }
    battery = b;
    const render = () => {
      const pct = Math.round(b.level * 100);
      const el = $('.c-batt');
      el.textContent = `${b.charging ? '⚡' : ''}${pct}%`;
      el.classList.toggle('charging', b.charging);
      setRing('bat', b.level, `${pct}`);
      updateCompactRight();
    };
    b.addEventListener('levelchange', render);
    b.addEventListener('chargingchange', () => {
      render();
      const pct = `${Math.round(b.level * 100)}%`;
      if (b.charging) showActivity({ icon: 'bolt', color: '#4ade80', sub: 'Power connected', title: 'Charging', right: pct, pulse: true });
      else showActivity({ icon: 'battery', sub: 'Power disconnected', title: 'On battery', right: pct });
    });
    render();
  }
  setupBattery();

  // ---------- quick actions & timer ----------
  function renderActions() {
    const box = $('.x-actions');
    box.replaceChildren();
    (cfg.notch.quickActions || []).forEach((a, index) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.innerHTML = `${Icons.glyph(a.icon)}<span></span>`;
      b.querySelector('span').textContent = a.label;
      if (a.action === 'timer') {
        b.dataset.timer = '1';
        b.classList.toggle('active', !!timer);
        if (timer) b.querySelector('span').textContent = 'Cancel';
      }
      b.addEventListener('click', () => runAction(a, index));
      box.append(b);
    });
  }

  function runAction(a, index) {
    if (a.action === 'timer') {
      if (timer) {
        timer = null;
        showActivity({ icon: 'timer', color: '#fb923c', sub: 'Timer', title: 'Cancelled' }, 1800);
      } else {
        const minutes = a.minutes || 5;
        timer = { end: Date.now() + minutes * 60000, minutes };
        showActivity({ icon: 'timer', color: '#fb923c', sub: 'Timer started', title: `${minutes} minute${minutes > 1 ? 's' : ''}`, right: mmss(minutes * 60) }, 2200);
      }
      renderActions();
      tick();
      return;
    }
    frost.action(index);
  }

  function finishTimer() {
    const minutes = timer.minutes;
    timer = null;
    renderActions();
    beep();
    showActivity({ icon: 'timer', color: '#fb923c', sub: 'Time is up', title: 'Timer finished', right: mmss(minutes * 60), pulse: true }, 7000);
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      [0, 0.28, 0.56].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.25);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch {}
  }

  // ---------- control center ----------
  const cc = {
    state: null,
    poll: null,
    dragging: { volume: false, brightness: false },
    send: {},
  };
  const pct = (v) => `${Math.round(v)}%`;

  async function ccRun(req) {
    try {
      const res = await frost.controls(req);
      if (res && res.state) renderCc(res.state);
      return res;
    } catch (err) {
      console.error('[controls]', err);
    }
  }

  function startCcPolling() {
    if (cc.poll) return;
    ccRun({ cmd: 'state' });
    cc.poll = setInterval(() => ccRun({ cmd: 'state' }), 3000);
  }
  function stopCcPolling() {
    clearInterval(cc.poll);
    cc.poll = null;
  }

  function setTile(name, on, sub, icon, enabled = true) {
    const t = document.querySelector(`.cc-tile[data-cc="${name}"]`);
    t.classList.toggle('on', !!on);
    t.disabled = !enabled;
    t.querySelector('.ti').innerHTML = Icons.glyph(icon);
    t.querySelector('small').textContent = sub;
  }

  function setSlider(name, value, enabled, icon) {
    const el = document.querySelector(`.cc-slider[data-cc="${name}"]`);
    const input = el.querySelector('input');
    el.classList.toggle('disabled', !enabled);
    input.disabled = !enabled;
    if (icon) el.querySelector('.si').innerHTML = Icons.glyph(icon);
    if (!cc.dragging[name] && enabled) {
      input.value = value;
      input.style.setProperty('--p', value / 100);
    }
    el.querySelector('.sv').textContent = enabled ? pct(cc.dragging[name] ? input.value : value) : 'N/A';
  }

  function volumeIcon(s) {
    if (s.muted || s.volume === 0) return 'muted';
    return s.volume < 0.5 ? 'volumeLow' : 'volume';
  }

  function renderCc(s) {
    cc.state = s;
    if (typeof wifi !== 'undefined' && wifi.open) renderWifiHead();
    if (typeof bt !== 'undefined' && bt.open) renderBtHead();
    // Wi-Fi
    const wifiSub = s.wifi === null ? (s.ethernet ? 'Ethernet' : 'Unavailable') : s.wifi ? s.ssid || 'Not connected' : 'Off';
    setTile('wifi', s.wifi, wifiSub, s.wifi === false ? 'wifiOff' : s.wifi === null && s.ethernet ? 'ethernet' : 'wifi', s.wifi !== null);
    // Bluetooth
    setTile('bluetooth', s.bluetooth, s.bluetooth === null ? 'Unavailable' : s.bluetooth ? 'On' : 'Off', 'bluetooth', s.bluetooth !== null);
    // Sound
    setTile('mute', s.muted, s.muted ? 'Muted' : 'On', s.muted ? 'muted' : 'volume', s.volume !== null);
    setTile('dark', s.darkMode, s.darkMode ? 'On' : 'Off', s.darkMode ? 'moon' : 'sun', s.darkMode !== null && s.darkMode !== undefined);
    // sliders
    setSlider('brightness', s.brightness ?? 0, s.brightness !== null, 'sun');
    const vol = Math.round((s.volume ?? 0) * 100);
    setSlider('volume', vol, s.volume !== null, volumeIcon(s));
    document.querySelector('.cc-slider[data-cc="volume"]').classList.toggle('muted', !!s.muted);
    // modes
    const normal = !s.airplane && !s.lowPower && !s.dnd;
    const modes = { normal, airplane: s.airplane, lowPower: s.lowPower, dnd: s.dnd };
    document.querySelectorAll('.cc-modes button').forEach((b) => {
      b.classList.toggle('on', !!modes[b.dataset.mode]);
      b.disabled = modes[b.dataset.mode] === null;
    });
  }

  function optimistic(patch) {
    if (cc.state) renderCc({ ...cc.state, ...patch });
  }

  // throttle slider writes: at most one in flight, always ends on the last value
  function sendLevel(name, value) {
    const job = cc.send[name] || (cc.send[name] = { busy: false, next: null });
    job.next = value;
    if (job.busy) return;
    cc.localAt = Date.now();
    const pump = async () => {
      if (job.next === null) return void (job.busy = false);
      job.busy = true;
      const v = job.next;
      job.next = null;
      await frost.controls(name === 'volume' ? { cmd: 'setVolume', value: v / 100 } : { cmd: 'setBrightness', value: v });
      pump();
    };
    pump();
  }

  document.querySelectorAll('.cc-slider').forEach((el) => {
    const name = el.dataset.cc;
    const input = el.querySelector('input');
    input.addEventListener('pointerdown', () => (cc.dragging[name] = true));
    const end = () => {
      if (!cc.dragging[name]) return;
      cc.dragging[name] = false;
      setTimeout(() => ccRun({ cmd: 'state' }), 250);
    };
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      input.style.setProperty('--p', v / 100);
      el.querySelector('.sv').textContent = pct(v);
      if (name === 'volume') {
        el.querySelector('.si').innerHTML = Icons.glyph(volumeIcon({ muted: false, volume: v / 100 }));
        el.classList.remove('muted');
      }
      sendLevel(name, v);
    });
    input.addEventListener('wheel', (e) => {
      if (input.disabled) return;
      e.preventDefault();
      input.value = Math.max(0, Math.min(100, Number(input.value) + (e.deltaY < 0 ? 5 : -5)));
      input.dispatchEvent(new Event('input'));
      setTimeout(() => ccRun({ cmd: 'state' }), 400);
    });
  });

  // mute: speaker icon on the slider and the Sound tile
  const toggleMute = (e) => {
    e.preventDefault();
    if (!cc.state) return;
    const muted = !cc.state.muted;
    cc.localAt = Date.now();
    optimistic({ muted });
    ccRun({ cmd: 'setMute', value: muted });
  };
  document.querySelector('[data-cc-mute]').addEventListener('click', toggleMute);
  document.querySelector('.cc-tile[data-cc="mute"]').addEventListener('click', toggleMute);

  // ---------- Wi-Fi picker ----------
  const ctrlPage = document.querySelector('.page[data-page="controls"]');
  const wifi = { open: false, nets: [], error: null, asking: null, busy: null, errors: {}, scanning: false, typing: false, pw: '' };
  const wpList = $('.wp-list');
  $('.wp-back').innerHTML = Icons.glyph('back');
  $('.wp-refresh').innerHTML = Icons.glyph('refresh');

  function openWifi() {
    if (typeof closeBt === 'function') closeBt();
    ctrlPage.classList.add('wifi-open');
    wifi.open = true;
    wifi.errors = {};
    renderWifi();
    loadWifi(false).then(() => loadWifi(true)); // cached list instantly, then a fresh scan
  }
  function closeWifi() {
    if (!wifi.open) return;
    ctrlPage.classList.remove('wifi-open');
    wifi.open = false;
    wifi.asking = null;
    endTyping();
  }

  async function loadWifi(scan) {
    if (!wifi.open) return;
    if (scan) wifi.scanning = true;
    renderWifiHead();
    const res = await ccRun({ cmd: 'wifiList', scan: !!scan });
    if (scan) wifi.scanning = false;
    if (res && res.wifi) {
      wifi.nets = res.wifi.networks || [];
      wifi.error = res.wifi.error || null;
    }
    renderWifi();
  }

  function startTyping(input) {
    if (!wifi.typing) {
      wifi.typing = true;
      frost.setFocusable(true); // let the keyboard reach the notch
    }
    setTimeout(() => input && input.focus(), 60);
  }
  function endTyping() {
    if (!wifi.typing) return;
    wifi.typing = false;
    frost.setFocusable(false);
  }
  window.addEventListener('blur', () => {
    // clicked somewhere else while typing: give focus back and fold away
    if (!wifi.typing) return;
    endTyping();
    if (!panel.matches(':hover')) {
      hover = false;
      setState();
    }
  });

  function renderWifiHead() {
    const on = !!(cc.state && cc.state.wifi);
    $('.wp-toggle').checked = on;
    $('.wp-refresh').classList.toggle('spin', wifi.scanning);
    $('.wp-refresh').disabled = !on;
    $('.wp-status').textContent = !on ? 'Off' : wifi.scanning ? 'Scanning…' : '';
  }

  function netSub(n) {
    if (wifi.busy === n.ssid) return 'Connecting…';
    if (n.connected) return n.secure ? 'Connected, secured' : 'Connected';
    if (n.auth === 'enterprise') return 'Work or school sign-in';
    if (n.saved) return 'Saved';
    return n.secure ? 'Secured' : 'Open';
  }

  function renderWifi() {
    renderWifiHead();
    if (wifi.typing) return; // never rebuild under the user's fingers
    const on = !!(cc.state && cc.state.wifi);
    wpList.replaceChildren();
    const msg = $('.wp-msg');
    msg.replaceChildren();
    if (!on) msg.textContent = 'Wi-Fi is off. Turn it on to see networks.';
    else if (wifi.error === 'location') {
      msg.innerHTML = '<div>Windows needs <b>Location</b> access to list nearby networks.</div><button class="wp-btn primary">Open location settings</button>';
      msg.querySelector('button').onclick = () => frost.openSettings('ms-settings:privacy-location');
    } else if (wifi.error === 'noadapter') msg.textContent = 'No Wi-Fi adapter found on this PC.';
    else if (!wifi.nets.length) msg.textContent = wifi.scanning ? 'Looking for networks…' : 'No networks found.';
    if (!on) return;

    for (const n of wifi.nets) {
      const el = document.createElement('div');
      el.className = 'wp-net' + (n.connected ? ' connected' : '') + (wifi.busy === n.ssid ? ' busy' : '') + (wifi.asking === n.ssid ? ' asking' : '');
      el.innerHTML = `<div class="wp-row"><span class="wp-sig">${Icons.signal(n.signal)}</span><span class="wp-name"><b></b><small></small></span><span class="wp-actions"></span></div>
        <div class="wp-form"><input type="password" placeholder="Password" maxlength="63" spellcheck="false" autocomplete="off" />
        <button class="icon-btn wp-eye" title="Show password">${Icons.glyph('eye')}</button><button class="wp-btn primary wp-go">Connect</button><div class="wp-err"></div></div>`;
      const name = el.querySelector('b');
      name.textContent = n.ssid;
      if (n.secure) name.insertAdjacentHTML('beforeend', Icons.glyph('lockSmall'));
      el.querySelector('small').textContent = netSub(n);
      const actions = el.querySelector('.wp-actions');
      const addBtn = (label, fn, primary) => {
        const b = document.createElement('button');
        b.className = 'wp-btn' + (primary ? ' primary' : '');
        b.textContent = label;
        b.disabled = !!wifi.busy;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        actions.append(b);
      };
      if (n.connected) addBtn('Disconnect', () => disconnectWifi());
      else if (n.saved && wifi.asking !== n.ssid) addBtn('Forget', () => forgetWifi(n));
      if (!n.connected && wifi.asking !== n.ssid && n.auth !== 'enterprise') addBtn('Connect', () => pickNetwork(n), true);
      if (n.auth === 'enterprise' && !n.connected) addBtn('Settings', () => frost.openSettings('ms-settings:network-wifi'));

      const err = el.querySelector('.wp-err');
      err.textContent = wifi.errors[n.ssid] || '';
      if (wifi.errors[n.ssid] && wifi.asking !== n.ssid) {
        // show the error under the row even without the password form
        el.classList.add('asking');
        el.querySelector('input').style.display = 'none';
        el.querySelector('.wp-eye').style.display = 'none';
        el.querySelector('.wp-go').style.display = 'none';
      }

      el.querySelector('.wp-row').addEventListener('click', () => !n.connected && !wifi.busy && pickNetwork(n));
      const input = el.querySelector('input');
      input.value = wifi.asking === n.ssid ? wifi.pw : '';
      input.addEventListener('input', () => (wifi.pw = input.value));
      input.addEventListener('focus', () => startTyping());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') {
          wifi.asking = null;
          wifi.pw = '';
          endTyping();
          renderWifi();
        }
      });
      el.querySelector('.wp-eye').addEventListener('click', (e) => {
        e.stopPropagation();
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = Icons.glyph(show ? 'eyeOff' : 'eye');
        input.focus();
      });
      const submit = () => {
        if (n.secure && wifi.pw.length < 8) {
          err.textContent = 'Wi-Fi passwords are at least 8 characters.';
          return;
        }
        connectWifi(n.ssid, wifi.pw);
      };
      el.querySelector('.wp-go').addEventListener('click', (e) => {
        e.stopPropagation();
        submit();
      });
      wpList.append(el);
      if (wifi.busy === n.ssid) input.disabled = true;
      else if (wifi.asking === n.ssid) startTyping(input);
    }
  }

  function pickNetwork(n) {
    endTyping();
    wifi.errors[n.ssid] = '';
    if (n.auth === 'enterprise') {
      wifi.errors[n.ssid] = 'This network needs a work or school sign-in. Use Windows Wi-Fi settings.';
      return renderWifi();
    }
    if (n.saved || !n.secure) return connectWifi(n.ssid, '');
    wifi.asking = n.ssid;
    wifi.pw = '';
    renderWifi();
  }

  async function connectWifi(ssid, password) {
    endTyping();
    wifi.busy = ssid;
    wifi.errors[ssid] = '';
    renderWifi();
    const res = await ccRun({ cmd: 'wifiConnect', ssid, password: password || '' });
    wifi.busy = null;
    const result = (res && res.wifi && res.wifi.result) || 'failed';
    if (res && res.wifi) wifi.nets = res.wifi.networks || wifi.nets;
    if (result === 'ok') {
      wifi.asking = null;
      wifi.pw = '';
      showActivity({ icon: 'wifi', sub: 'Wi-Fi', title: `Connected to ${ssid}` }, 2000);
    } else if (result === 'needpassword') {
      wifi.asking = ssid;
    } else if (result === 'password') {
      wifi.asking = ssid;
      wifi.errors[ssid] = 'Couldn’t connect. Check the password and try again.';
    } else if (result === 'enterprise') {
      wifi.errors[ssid] = 'This network needs a work or school sign-in. Use Windows Wi-Fi settings.';
    } else {
      wifi.errors[ssid] = 'Couldn’t connect to this network.';
    }
    endTyping(); // allow the rebuild; the form refocuses itself if still needed
    renderWifi();
  }

  async function disconnectWifi() {
    const res = await ccRun({ cmd: 'wifiDisconnect' });
    if (res && res.wifi) wifi.nets = res.wifi.networks || [];
    renderWifi();
  }

  async function forgetWifi(n) {
    const res = await ccRun({ cmd: 'wifiForget', profile: n.profile });
    if (res && res.wifi) wifi.nets = res.wifi.networks || [];
    renderWifi();
  }

  $('.wp-back').addEventListener('click', closeWifi);
  $('.wp-refresh').addEventListener('click', () => loadWifi(true));
  $('.wp-more').addEventListener('click', () => frost.openSettings('ms-settings:network-wifi'));
  $('.wp-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    optimistic({ wifi: on, ssid: on ? cc.state && cc.state.ssid : null });
    if (!on) wifi.nets = [];
    renderWifi();
    await ccRun({ cmd: 'setRadio', kind: 'WiFi', on });
    if (on) setTimeout(() => loadWifi(true), 1500);
    else renderWifi();
  });

  // the Wi-Fi tile opens the picker (on/off lives in the picker header)
  document.querySelector('.cc-tile[data-cc="wifi"]').addEventListener('click', () => {
    if (!cc.state || cc.state.wifi === null) return;
    openWifi();
  });

  // ---------- Bluetooth devices ----------
  const btPanel = document.querySelector('.wp-bt');
  const bq = (sel) => btPanel.querySelector(sel);
  const bt = { open: false, devices: [], busy: null, errors: {}, loading: false, poll: null };
  bq('.bt-back').innerHTML = Icons.glyph('back');
  bq('.bt-refresh').innerHTML = Icons.glyph('refresh');
  const btIcon = { audio: 'headphones', input: 'mouse', phone: 'phone', computer: 'laptop', other: 'bluetooth' };

  function openBt() {
    closeWifi();
    ctrlPage.classList.add('bt-open');
    bt.open = true;
    bt.errors = {};
    renderBt();
    loadBt();
    clearInterval(bt.poll);
    bt.poll = setInterval(() => !bt.busy && loadBt(true), 5000); // headphones come and go
  }
  function closeBt() {
    if (!bt.open) return;
    ctrlPage.classList.remove('bt-open');
    bt.open = false;
    clearInterval(bt.poll);
  }

  async function loadBt(quiet) {
    if (!bt.open) return;
    if (!quiet) bt.loading = true;
    renderBtHead();
    const res = await ccRun({ cmd: 'btList' });
    bt.loading = false;
    if (res && res.bt) bt.devices = res.bt.devices || [];
    renderBt();
  }

  function renderBtHead() {
    const on = !!(cc.state && cc.state.bluetooth);
    bq('.bt-toggle').checked = on;
    bq('.bt-refresh').classList.toggle('spin', bt.loading);
    bq('.bt-status').textContent = !on ? 'Off' : bt.loading ? 'Refreshing…' : '';
  }

  function renderBt() {
    renderBtHead();
    const on = !!(cc.state && cc.state.bluetooth);
    const list = bq('.bt-list');
    const msg = bq('.bt-msg');
    list.replaceChildren();
    msg.textContent = !on
      ? 'Bluetooth is off. Turn it on to connect your devices.'
      : !bt.devices.length
        ? bt.loading
          ? 'Looking for your devices…'
          : 'No paired devices yet. Use “Add device” to pair one.'
        : '';
    if (!on) return;
    for (const d of bt.devices) {
      const el = document.createElement('div');
      const busy = bt.busy === d.container;
      el.className = 'wp-net' + (d.connected ? ' connected' : '') + (busy ? ' busy' : '');
      el.innerHTML = `<div class="wp-row"><span class="wp-sig bt">${Icons.glyph(btIcon[d.kind] || 'bluetooth')}</span><span class="wp-name"><b></b><small></small></span><span class="wp-actions"></span></div><div class="wp-form"><div class="wp-err"></div></div>`;
      el.querySelector('b').textContent = d.name;
      el.querySelector('small').textContent = busy
        ? d.connected
          ? 'Disconnecting…'
          : 'Connecting…'
        : d.connected
          ? 'Connected'
          : d.canConnect
            ? 'Paired'
            : 'Paired · connects on its own';
      if (d.canConnect) {
        const b = document.createElement('button');
        b.className = 'wp-btn' + (d.connected ? '' : ' primary');
        b.textContent = d.connected ? 'Disconnect' : 'Connect';
        b.disabled = !!bt.busy;
        b.addEventListener('click', () => btConnect(d, !d.connected));
        el.querySelector('.wp-actions').append(b);
      }
      if (bt.errors[d.container]) {
        el.classList.add('asking');
        el.querySelector('.wp-err').textContent = bt.errors[d.container];
      }
      list.append(el);
    }
  }

  async function btConnect(d, on) {
    bt.busy = d.container;
    bt.errors[d.container] = '';
    renderBt();
    const res = await ccRun({ cmd: 'btConnect', container: d.container, on });
    bt.busy = null;
    if (res && res.bt) bt.devices = res.bt.devices || bt.devices;
    const result = res && res.bt && res.bt.result;
    if (result !== 'ok') bt.errors[d.container] = 'Couldn’t do that from here. Try Bluetooth settings.';
    else if (on) showActivity({ icon: 'headphones', sub: 'Bluetooth', title: `Connected to ${d.name}` }, 2000);
    renderBt();
  }

  bq('.bt-back').addEventListener('click', closeBt);
  bq('.bt-refresh').addEventListener('click', () => loadBt());
  btPanel.querySelectorAll('.wp-more').forEach((b) => b.addEventListener('click', () => frost.openSettings(b.dataset.settings)));
  bq('.bt-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    optimistic({ bluetooth: on });
    renderBt();
    await ccRun({ cmd: 'setRadio', kind: 'Bluetooth', on });
    setTimeout(() => loadBt(true), 1200);
  });

  // the Bluetooth tile opens the device list (on/off lives in the panel header)
  document.querySelector('.cc-tile[data-cc="bluetooth"]').addEventListener('click', () => {
    if (!cc.state || cc.state.bluetooth === null) return;
    openBt();
  });

  // ---------- light / dark ----------
  document.querySelector('.cc-tile[data-cc="dark"]').addEventListener('click', () => {
    if (!cc.state) return;
    const on = !cc.state.darkMode;
    optimistic({ darkMode: on });
    ccRun({ cmd: 'setDarkMode', on }); // Windows (and FrostShell, when theme = auto) switch together
  });

  const modeInfo = {
    normal: { label: 'Normal', icon: 'sparkle' },
    airplane: { label: 'Airplane', icon: 'plane' },
    lowPower: { label: 'Low power', icon: 'leaf' },
    dnd: { label: 'Focus', icon: 'moon' },
  };
  document.querySelectorAll('.cc-modes button').forEach((b) => {
    const info = modeInfo[b.dataset.mode];
    b.innerHTML = `${Icons.glyph(info.icon)}<span>${info.label}</span>`;
    b.addEventListener('click', async () => {
      const s = cc.state;
      if (!s) return;
      const mode = b.dataset.mode;
      if (mode === 'normal') {
        optimistic({ airplane: false, lowPower: false, dnd: false });
        if (s.airplane) await ccRun({ cmd: 'setAirplane', on: false });
        if (s.lowPower) await ccRun({ cmd: 'setLowPower', on: false });
        if (s.dnd) await ccRun({ cmd: 'setDnd', on: false });
        return;
      }
      const cmd = { airplane: 'setAirplane', lowPower: 'setLowPower', dnd: 'setDnd' }[mode];
      const on = !s[mode];
      optimistic({ [mode]: on, ...(mode === 'airplane' ? { wifi: !on && s.wifi, bluetooth: !on && s.bluetooth } : {}) });
      ccRun({ cmd, on });
      if (mode === 'dnd') showActivity({ icon: 'moon', color: '#c38bff', sub: 'Focus', title: on ? 'Do not disturb on' : 'Notifications on' }, 1800);
      if (mode === 'airplane') showActivity({ icon: 'plane', color: '#fb923c', sub: 'Airplane mode', title: on ? 'On — radios off' : 'Off' }, 1800);
    });
  });

  // right-click any control → open the matching Windows Settings page
  document.querySelector('.x-cc').addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-settings]');
    if (!el) return;
    e.preventDefault();
    frost.openSettings(el.dataset.settings);
  });

  // expanded height follows its content so the spring morph lands exactly
  const expandedView = document.querySelector('.view.expanded');
  const measure = () => island.style.setProperty('--xh', `${expandedView.offsetHeight}px`);
  new ResizeObserver(measure).observe(expandedView);
  measure();

  // ---------- notifications ----------
  // UX: a new notification morphs the notch into a toast (icon, app, title, 2-line body)
  // with a draining progress bar. Hover pauses it and reveals Open / Dismiss. Several at
  // once queue up ("+2"). Unseen ones leave a red badge on the compact notch; hovering
  // then opens straight on the Notifications tab. Focus mode = badge only, no pop-up.
  const notif = { list: [], unread: new Set(), queue: [], current: null, timer: null, remaining: 0, started: 0 };
  const appIcons = new Map();
  const toastEl = $('.toast');

  function iconUrl(app) {
    if (!appIcons.has(app)) appIcons.set(app, frost.icon({ path: `shell:AppsFolder\\${app}` }).catch(() => null));
    return appIcons.get(app);
  }

  function fillIcon(box, n) {
    const img = box.querySelector('img') || box.appendChild(new Image());
    img.className = '';
    img.removeAttribute('src');
    box.querySelectorAll('svg').forEach((s) => s.remove());
    if (n.image) {
      img.className = 'avatar';
      img.src = n.image;
      return;
    }
    img.style.display = 'none';
    box.insertAdjacentHTML('beforeend', Icons.glyph('bell'));
    iconUrl(n.app).then((url) => {
      if (!url) return;
      box.querySelectorAll('svg').forEach((s) => s.remove());
      img.style.display = '';
      img.src = url;
    });
  }

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(t);
  }

  function dayLabel(t) {
    const d = new Date(t);
    const today = new Date();
    const y = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
  }

  function itemEl(n) {
    const el = document.createElement('div');
    el.className = 'n-item' + (notif.unread.has(n.id) ? ' unread' : '');
    el.innerHTML = `<div class="t-icon"></div><div class="t-main"><div class="t-head"><span class="t-app"></span><span class="t-time"></span></div><div class="t-title"></div><div class="t-body"></div></div><button class="n-x" title="Dismiss">${Icons.glyph('close')}</button>`;
    fillIcon(el.querySelector('.t-icon'), n);
    el.querySelector('.t-app').textContent = n.appName || n.app;
    el.querySelector('.t-time').textContent = ago(n.time);
    el.querySelector('.t-title').textContent = n.title;
    el.querySelector('.t-body').textContent = n.body;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.n-x')) {
        el.classList.add('leaving');
        setTimeout(() => dismiss(n.id), 220);
        return;
      }
      openNotif(n);
    });
    return el;
  }

  function renderList() {
    const max = cfg.notch.notifications?.max ?? 50;
    const items = notif.list.slice(0, max);
    const box = $('.n-list');
    box.replaceChildren();
    let day = '';
    for (const n of items) {
      const label = dayLabel(n.time);
      if (label !== day) {
        day = label;
        const h = document.createElement('div');
        h.className = 'n-day';
        h.textContent = label;
        box.append(h);
      }
      box.append(itemEl(n));
    }
    island.classList.toggle('no-notifs', !items.length);
    // newest one on the Home page, if it's recent
    const latest = $('.x-latest');
    latest.replaceChildren();
    if (items[0] && Date.now() - items[0].time < 6 * 3600e3) {
      const el = itemEl(items[0]);
      el.querySelector('.n-x').remove();
      el.onclick = null;
      el.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        selectTab('notifs');
      }, true);
      latest.append(el);
    }
    updateBadge();
  }

  function updateBadge() {
    const n = notif.unread.size;
    island.classList.toggle('has-unread', n > 0);
    $('.badge').textContent = n > 9 ? '9+' : n;
    const tc = $('.tab-count');
    tc.textContent = n > 9 ? '9+' : n;
    tc.classList.toggle('on', n > 0);
  }

  function markAllRead() {
    if (!notif.unread.size) return;
    notif.unread.clear();
    document.querySelectorAll('.n-item.unread').forEach((el) => el.classList.remove('unread'));
    updateBadge();
  }

  function popupsAllowed() {
    const n = cfg.notch.notifications || {};
    return n.enabled !== false && n.popup !== false && !(cc.state && cc.state.dnd);
  }

  function nextToast() {
    const n = notif.queue.shift();
    notif.current = n || null;
    if (!n) return setState();
    fillIcon($('.toast .t-icon'), n);
    $('.toast .t-app').textContent = n.appName || n.app;
    $('.toast .t-time').textContent = 'now';
    $('.toast .t-title').textContent = n.title;
    $('.toast .t-body').textContent = n.body;
    const more = $('.t-more');
    more.textContent = `+${notif.queue.length}`;
    more.classList.toggle('on', notif.queue.length > 0);
    toastEl.classList.remove('hover');
    const base = cfg.notch.notifications?.duration ?? 6000;
    notif.remaining = notif.queue.length ? Math.min(base, 4000) : base;
    const bar = $('.t-progress i');
    bar.classList.remove('run');
    void bar.offsetWidth;
    bar.style.setProperty('--dur', `${notif.remaining}ms`);
    bar.classList.add('run');
    island.style.setProperty('--th', `${toastEl.offsetHeight}px`);
    pulse('#7aa7ff');
    setState();
    runToastTimer();
  }

  function runToastTimer() {
    clearTimeout(notif.timer);
    notif.started = Date.now();
    notif.timer = setTimeout(endToast, notif.remaining);
  }

  function endToast() {
    clearTimeout(notif.timer);
    notif.current = null;
    nextToast();
  }

  toastEl.addEventListener('mouseenter', () => {
    if (!notif.current) return;
    clearTimeout(notif.timer);
    notif.remaining -= Date.now() - notif.started;
    toastEl.classList.add('hover');
    requestAnimationFrame(() => island.style.setProperty('--th', `${toastEl.scrollHeight}px`));
  });
  toastEl.addEventListener('mouseleave', () => {
    if (!notif.current) return;
    toastEl.classList.remove('hover');
    notif.remaining = Math.max(notif.remaining, 1500);
    island.style.setProperty('--th', `${toastEl.offsetHeight}px`);
    runToastTimer();
  });
  new ResizeObserver(() => {
    if (state === 'toast') island.style.setProperty('--th', `${toastEl.offsetHeight}px`);
  }).observe(toastEl);
  toastEl.addEventListener('click', (e) => {
    const n = notif.current;
    if (!n) return;
    if (e.target.closest('[data-t="dismiss"]')) dismiss(n.id);
    else openNotif(n);
    endToast();
  });

  function openNotif(n) {
    notif.unread.delete(n.id);
    frost.notifOpen(n.id);
    updateBadge();
  }

  function dismiss(id) {
    notif.unread.delete(id);
    notif.list = notif.list.filter((n) => n.id !== id);
    frost.notifDismiss([id]);
    renderList();
  }

  $('.n-clear').addEventListener('click', () => {
    const ids = notif.list.map((n) => n.id);
    document.querySelectorAll('.n-list .n-item').forEach((el, i) => setTimeout(() => el.classList.add('leaving'), i * 30));
    setTimeout(() => {
      notif.unread.clear();
      notif.list = [];
      frost.notifDismiss(ids);
      renderList();
    }, 260);
  });
  $('.n-empty-icon').innerHTML = Icons.glyph('bell');

  function onNotifications(p) {
    if (!p) return;
    notif.list = p.list || [];
    for (const n of p.fresh || []) {
      notif.unread.add(n.id);
      if (popupsAllowed()) notif.queue.push(n);
    }
    renderList();
    if (notif.queue.length && !notif.current) nextToast();
    else if (notif.current) {
      const more = $('.t-more');
      more.textContent = `+${notif.queue.length}`;
      more.classList.toggle('on', notif.queue.length > 0);
    }
  }
  frost.on('notifications', onNotifications);
  setInterval(() => state !== 'expanded' && renderList(), 60000); // refresh relative times

  // ---------- OSD: volume / brightness changed by hardware keys ----------
  const osdEl = $('.osd');
  function onOsd(p) {
    if (!p) return;
    // keep the Controls tab in sync no matter where the change came from
    if (cc.state) {
      if (p.kind === 'volume') renderCc({ ...cc.state, volume: p.value, muted: p.muted });
      else renderCc({ ...cc.state, brightness: Math.round(p.value * 100) });
    }
    if (cfg.notch.osd === false) return;
    if (Date.now() - (cc.localAt || 0) < 1500) return; // our own slider/mute did this
    if (state === 'expanded' || state === 'toast') return; // already visible / busy
    osd = p;
    const muted = p.kind === 'volume' && (p.muted || p.value === 0);
    osdEl.classList.toggle('brightness', p.kind === 'brightness');
    osdEl.classList.toggle('muted', muted);
    $('.o-icon').innerHTML = Icons.glyph(p.kind === 'brightness' ? 'sun' : muted ? 'muted' : p.value < 0.5 ? 'volumeLow' : 'volume');
    $('.o-bar').style.setProperty('--v', Math.max(0, Math.min(1, p.value)).toFixed(3));
    $('.o-val').textContent = muted ? 'Muted' : `${Math.round(p.value * 100)}%`;
    setState();
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      osd = null;
      setState();
    }, 1600);
  }
  frost.on('osd', onOsd);

  // ---------- boot ----------
  applyStyle();
  renderActions();
  renderMedia(undefined);
  lastKey = media.active ? media.key : null;
  setK(restK(), false);
  onNotifications({ list: init.notifications || [], fresh: [] });
  setState();
  setInterval(tick, 1000);

  // preview hooks (used by docs/preview.html & screenshots)
  window.__notch = {
    showActivity,
    setHover: (v) => ((pinned = v), setState()),
    osd: onOsd,
    selectTab,
    openWifi: () => openWifi(),
    openBt: () => openBt(),
    notify: (n) => onNotifications({ list: [n, ...notif.list], fresh: [n] }),
  };
})();
