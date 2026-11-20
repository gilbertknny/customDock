(async function () {
  const ui = window.FrostUI;
  const $ = (s) => document.querySelector(s);
  const island = $('#island');

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

  ui.glassify(island);
  ui.boot(init, {
    onConfig: (p) => {
      cfg = p.config;
      applyStyle();
      renderActions();
      tick();
    },
  });

  // ---------- state machine ----------
  function setState() {
    const expand = (hover && cfg.island.expandOnHover) || pinned;
    const s = expand ? 'expanded' : activity ? 'activity' : 'compact';
    island.classList.remove('s-compact', 's-activity', 's-expanded');
    island.classList.add(`s-${s}`);
    ui.kick();
  }

  function applyStyle() {
    island.classList.toggle('black', cfg.island.style === 'black');
  }

  function showActivity(a, duration = cfg.island.activityDuration || 3500) {
    activity = a;
    const icon = $('.a-icon');
    island.style.setProperty('--icon-color', a.color || '');
    island.style.setProperty('--pulse', a.color ? `${a.color}aa` : '');
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
    if (a.pulse) {
      island.classList.remove('pulse');
      void island.offsetWidth;
      island.classList.add('pulse');
    }
    setState();
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      activity = null;
      island.classList.remove('pulse');
      setState();
    }, duration);
  }

  island.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hover = true;
      setState();
    }, 90);
  });
  island.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hover = false;
      pinned = false;
      setState();
    }, 320);
  });
  island.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (!cfg.island.expandOnHover) {
      pinned = !pinned;
      setState();
    }
  });

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
      hour12: !cfg.island.clock24h,
    }).format(new Date());
  }

  function tick() {
    $('.c-time').textContent = timeString(cfg.island.showSeconds);
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
    for (const a of cfg.island.quickActions || []) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.innerHTML = `${Icons.glyph(a.icon)}<span></span>`;
      b.querySelector('span').textContent = a.label;
      if (a.action === 'timer') {
        b.dataset.timer = '1';
        b.classList.toggle('active', !!timer);
        if (timer) b.querySelector('span').textContent = 'Cancel';
      }
      b.addEventListener('click', () => runAction(a));
      box.append(b);
    }
  }

  function runAction(a) {
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
    frost.action(a);
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

  // ---------- boot ----------
  applyStyle();
  renderActions();
  renderMedia(undefined);
  lastKey = media.active ? media.key : null;
  setState();
  setInterval(tick, 1000);

  // preview hooks (used by docs/preview.html & screenshots)
  window.__island = { showActivity, setHover: (v) => ((pinned = v), setState()) };
})();
