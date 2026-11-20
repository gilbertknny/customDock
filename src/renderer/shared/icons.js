// Line glyphs for the notch UI. Dock icons always come from Windows itself.
(function () {
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
    sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
    volume: s('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
    volumeLow: s('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
    muted: s('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/>'),
    wifi: s('<path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>'),
    wifiOff: s('<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>'),
    ethernet: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M8 8v4M12 8v4M16 8v4"/>'),
    bluetooth: s('<path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11"/>'),
    plane: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>',
    leaf: s('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'),
    moon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    sparkle: s('<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>'),
    back: s('<path d="M15 18l-6-6 6-6"/>'),
    refresh: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    lockSmall: s('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    eye: s('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: s('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>'),
    bell: s('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>'),
    close: s('<path d="M18 6L6 18M6 6l12 12"/>'),
    battery: s('<rect x="2" y="7" width="18" height="10" rx="2.5"/><path d="M22 11v2"/>'),
  };

  const placeholder =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9h16"/></svg>';

  // Wi-Fi strength: 1-4 arcs lit
  function signal(pct) {
    const lvl = pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1;
    const arc = (d, on) => `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity="${on ? 1 : 0.25}"/>`;
    return `<svg viewBox="0 0 24 24">${arc('M2 8.8a15 15 0 0 1 20 0', lvl >= 4)}${arc('M5 12.3a10 10 0 0 1 14 0', lvl >= 3)}${arc('M8.5 15.8a5 5 0 0 1 7 0', lvl >= 2)}<circle cx="12" cy="19.5" r="1.4" fill="currentColor" opacity="${lvl >= 1 ? 1 : 0.25}"/></svg>`;
  }

  window.Icons = { placeholder, signal, glyph: (n) => glyphs[n] || glyphs.music };
})();
