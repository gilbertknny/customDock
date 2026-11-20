// Built-in SVG icons: app tiles for the dock and line glyphs for the island.
(function () {
  const tileBg = {
    terminal: ['#2b2f3a', '#0d0f14'],
    calculator: ['#5b6bff', '#2a2f8f'],
    settings: ['#8e9aaf', '#4b5568'],
    trash: ['#e9edf5', '#aab3c5'],
    folder: ['#ffd36b', '#f5a524'],
    app: ['#7aa7ff', '#a374ff'],
  };

  const tileGlyph = {
    terminal:
      '<path d="M30 38l14 12-14 12" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M52 64h20" stroke="#7af0b0" stroke-width="6" stroke-linecap="round"/>',
    calculator:
      '<rect x="30" y="24" width="40" height="52" rx="7" fill="#fff" fill-opacity=".95"/><rect x="36" y="30" width="28" height="11" rx="3" fill="#2a2f8f" fill-opacity=".85"/><g fill="#2a2f8f" fill-opacity=".8"><circle cx="40" cy="51" r="3.4"/><circle cx="50" cy="51" r="3.4"/><circle cx="60" cy="51" r="3.4"/><circle cx="40" cy="61" r="3.4"/><circle cx="50" cy="61" r="3.4"/><circle cx="60" cy="61" r="3.4"/><circle cx="40" cy="70" r="3"/><circle cx="50" cy="70" r="3"/><circle cx="60" cy="70" r="3" fill="#ff8a3d" fill-opacity="1"/></g>',
    settings:
      '<g transform="translate(50 50)"><g fill="#fff">' +
      Array.from({ length: 8 }, (_, i) => `<rect x="-5" y="-30" width="10" height="14" rx="3" transform="rotate(${i * 45})"/>`).join('') +
      '</g><circle r="20" fill="#fff"/><circle r="9" fill="#5d677b"/></g>',
    trash:
      '<path d="M33 36h34l-3 38a5 5 0 0 1-5 4H41a5 5 0 0 1-5-4z" fill="#fff" fill-opacity=".9" stroke="#8a93a6" stroke-width="2"/><path d="M42 44v26M50 44v26M58 44v26" stroke="#8a93a6" stroke-width="2.5" stroke-linecap="round"/><rect x="28" y="28" width="44" height="7" rx="3.5" fill="#8a93a6"/><rect x="44" y="23" width="12" height="6" rx="2" fill="#8a93a6"/>',
    folder:
      '<path d="M22 34a5 5 0 0 1 5-5h15l6 6h25a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5z" fill="#fff" fill-opacity=".9"/>',
  };

  function tile(name, label) {
    const [a, b] = tileBg[name] || tileBg.app;
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    const glyph =
      tileGlyph[name] ||
      `<text x="50" y="63" text-anchor="middle" font-family="Segoe UI Variable Display, Segoe UI, sans-serif" font-size="40" font-weight="600" fill="#fff">${
        (label || '?').trim().charAt(0).toUpperCase().replace(/[<&>]/g, '')
      }</text>`;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect x="6" y="6" width="88" height="88" rx="22" fill="url(#${id})"/><rect x="6.5" y="6.5" width="87" height="87" rx="21.5" fill="none" stroke="#fff" stroke-opacity=".25"/>${glyph}</svg>`;
  }

  const s = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  const glyphs = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.5" height="16" rx="1.5"/><rect x="14" y="4" width="4.5" height="16" rx="1.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.2v11.6a.8.8 0 0 0 1.2.7L13 12.7V17.8a.8.8 0 0 0 1.2.7l8.4-5.8a.8.8 0 0 0 0-1.4L14.2 5.5a.8.8 0 0 0-1.2.7v5.1L4.2 5.5A.8.8 0 0 0 3 6.2z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" style="transform:scaleX(-1)"><path d="M3 6.2v11.6a.8.8 0 0 0 1.2.7L13 12.7V17.8a.8.8 0 0 0 1.2.7l8.4-5.8a.8.8 0 0 0 0-1.4L14.2 5.5a.8.8 0 0 0-1.2.7v5.1L4.2 5.5A.8.8 0 0 0 3 6.2z"/></svg>',
    scissors: s('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>'),
    timer: s('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    lock: s('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.5z"/></svg>',
    music: s('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    plug: s('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
    battery: s('<rect x="2" y="7" width="18" height="10" rx="2.5"/><path d="M22 11v2"/>'),
  };

  window.Icons = { tile, glyph: (n) => glyphs[n] || glyphs.music };
})();
