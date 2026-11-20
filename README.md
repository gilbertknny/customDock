<div align="center">

<img src="assets/icon.png" width="96" alt="FrostShell" />

# FrostShell

**A glassmorphism dock + Dynamic Island for Windows 11.**

macOS-style magnifying dock and an iPhone-style Dynamic Island with media controls, live activities, and system stats, all in frosted glass.

![Windows 11](https://img.shields.io/badge/Windows-11-0078D4?logo=windows11&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/expanded.png" alt="FrostShell expanded island and dock" width="900" />

</div>

---

## ✨ Features

### 🏝️ Dynamic Island
- **Compact pill** with the clock, a spinning album-art disc, and an equalizer while music plays
- **Hover to expand**: big clock + date, CPU/RAM/battery rings, a now-playing card, and quick actions
- **Media controls** for anything that shows up in Windows' media flyout (Spotify, YouTube in Chrome/Edge, Apple Music, VLC, Media Player…), via the native SMTC API
- **Live activities** that morph the island:
  - 🎵 track changed → "Now playing"
  - ⚡ charger plugged / unplugged
  - ⏱️ quick timer with countdown in the pill + chime when done
- **Spring physics** morphing between compact → activity → expanded
- Two styles: **Glass** or **Black (iPhone)**

### 🚀 Dock
- **macOS-style magnification** with smooth cosine falloff
- **Native Windows icons** for everything (Win32 `.exe`/`.lnk`, Microsoft Store apps, Settings, Recycle Bin…), extracted at up to 256 px so they stay sharp when magnified
- **Uniform square plates**: every icon sits on the same rounded-square glass tile, so mixed icon shapes line up neatly (`"iconStyle": "plain"` turns it off)
- **Running indicators** (dot under apps that are open)
- **Launch bounce** animation
- **Drag to reorder**, right-click → *Add app…*, *Remove*, *Show file location*, *Add separator*
- **Auto-hide** with a bottom hot-edge
- Supports `.exe`, `.lnk`, URIs (`ms-settings:`, `spotify:`…) and custom args

### 🧊 Glassmorphism done properly
CSS `backdrop-filter` **can't** see the desktop behind a transparent window, so most "glass" widgets end up as flat translucent boxes. FrostShell reads your **current wallpaper** (including Spotlight/slideshow via `TranscodedWallpaper`), places a copy behind every glass surface aligned to its exact screen position, and blurs + saturates *that*. On top of that you get a specular rim, a soft sheen gradient, and film-grain noise. It updates automatically when the wallpaper changes.

Prefer something simpler? Switch to **Tint only** mode from the tray.

<table>
<tr>
<td><img src="docs/magnify.png" alt="Dock magnification" /></td>
<td><img src="docs/activity.png" alt="Charging live activity" /></td>
</tr>
<tr>
<td><img src="docs/light.png" alt="Light theme" /></td>
<td><img src="docs/black.png" alt="Black iPhone-style island" /></td>
</tr>
</table>

> Screenshots come from `docs/preview.html` with a demo wallpaper. Open it in a browser to play with the UI without installing anything.

---

## 📦 Install

### Option A: download a release
Grab `FrostShell-Setup-x.y.z.exe` (installer) or the portable `.exe` from **Releases**.

### Option B: run from source
```bash
git clone https://github.com/gilbertknny/customDock.git
cd customDock
npm install
npm start          # run
npm run demo       # run with fake media data
npm run dist       # build installer + portable exe into dist/
```
Requires **Node.js 20+** and **Windows 10 1809+ / Windows 11** (best on 11).

### Recommended Windows settings
- **Auto-hide the taskbar** (Settings → Personalization → Taskbar → Taskbar behaviors) so the dock can sit at the very bottom, then set `"aboveTaskbar": false`.
- Turn on **Start with Windows** from the FrostShell tray menu.

---

## ⚙️ Configuration

Everything lives in `%APPDATA%\FrostShell\config.json` (tray → *Edit config…*). Changes apply **live** when you save.

```jsonc
{
  "theme": "auto",                 // auto | dark | light
  "glass": {
    "mode": "wallpaper",           // wallpaper | tint
    "blur": 26,                    // px
    "saturation": 1.8,
    "tint": 0.22,                  // 0–1 tint layer opacity
    "border": 0.28,                // rim highlight strength
    "noise": 0.05                  // film grain
  },
  "dock": {
    "enabled": true,
    "iconSize": 50,
    "magnification": 1.65,         // 1 = off
    "autoHide": false,
    "aboveTaskbar": true,
    "margin": 10,
    "iconStyle": "square",         // square (uniform plate) | plain
    "items": [
      { "name": "Edge", "path": "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" },
      { "name": "Terminal", "path": "shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", "process": "WindowsTerminal.exe" },
      { "name": "Settings", "path": "ms-settings:", "process": "SystemSettings.exe" },
      { "type": "separator" },
      { "name": "Recycle Bin", "path": "shell:RecycleBinFolder", "process": false }
    ]
  },
  "island": {
    "enabled": true,
    "style": "glass",              // glass | black
    "clock24h": true,
    "showSeconds": false,
    "expandOnHover": true,         // false = click to expand
    "activityDuration": 3500,
    "quickActions": [
      { "label": "Snip", "icon": "scissors", "uri": "ms-screenclip:" },
      { "label": "Timer 5m", "icon": "timer", "action": "timer", "minutes": 5 },
      { "label": "Lock", "icon": "lock", "path": "rundll32.exe", "args": ["user32.dll,LockWorkStation"] }
    ]
  }
}
```

**Dock item fields**

| Field | Description |
|---|---|
| `name` | Tooltip label |
| `path` | `.exe`, `.lnk`, folder, URI (`ms-settings:`, `steam://…`), `shell:RecycleBinFolder`, or a Store app as `shell:AppsFolder\\<AUMID>`. `%ENV%` vars are expanded |
| `args` | Optional argument array |
| `icon` | Optional override. By default the app's own Windows icon is used. Accepts `.png/.ico/.jpg`, or a resource like `%WINDIR%\\System32\\imageres.dll,-55` |
| `process` | Process name for the running dot. Defaults to the exe name; `false` disables it |

**Quick action icons:** `scissors`, `timer`, `lock`, `gear`, `music`, `bolt`, `plug`, `battery`.

> 💡 Tip: find a Store app's AUMID with `Get-StartApps` in PowerShell.

---

## 🧱 How it works

```
src/
├── main.js              # windows, tray, IPC, launching, frost:// protocol
├── preload.js           # safe bridge (contextIsolation + sandbox)
├── config.js            # load/merge/watch config.json
├── system/
│   ├── media.ps1        # WinRT SMTC bridge (now playing + controls)
│   ├── media.js         # long-running PowerShell watcher, art cache
│   ├── icons.ps1/.js    # native Windows icon extraction (exe/dll + Store apps)
│   ├── wallpaper.js     # finds & watches the current wallpaper
│   ├── processes.js     # running-app detection (tasklist)
│   └── stats.js         # CPU / RAM
└── renderer/
    ├── shared/          # glass.css, ui.js (glass alignment, click-through), icons
    ├── dock/
    └── island/
```

- Both surfaces are **transparent, frameless, always-on-top, non-focusable** windows. Empty pixels pass clicks through to the desktop (`setIgnoreMouseEvents` with forwarding); only elements marked `data-hit` catch the mouse.
- Glass layers are re-aligned every animation frame while things morph, so the blur always matches what's actually behind it.
- The media bridge is a single PowerShell process that prints JSON lines, so there's no native Node module to compile.

---

## 🗺️ Roadmap
- [ ] Multi-monitor (dock per display)
- [ ] Left/right dock positions
- [ ] Hide over fullscreen apps & games
- [ ] Notification mirroring in the island
- [ ] Volume / brightness OSD replacement
- [ ] Native acrylic/mica mode (blur real windows, not only the wallpaper)
- [ ] Settings GUI
- [ ] Window previews on dock hover

PRs are very welcome!

---

## 🇮🇩 Bahasa Indonesia

**FrostShell** itu dock ala macOS + Dynamic Island ala iPhone buat Windows 11, dengan gaya glassmorphism.

- **Island**: jam, kontrol musik (Spotify/YouTube/dll.), notifikasi charging, timer, CPU/RAM/baterai. Hover buat expand.
- **Dock**: efek magnify, ikon asli bawaan Windows (diseragamkan di atas alas kotak), indikator app yang lagi jalan, drag buat ngatur urutan, auto-hide.
- **Glass beneran**: wallpaper kamu di-blur di belakang tiap panel, jadi efek kacanya kelihatan nyata, bukan cuma kotak transparan.

Cara pakai: `npm install` lalu `npm start`. Pengaturan ada di `%APPDATA%\FrostShell\config.json` (klik kanan ikon tray → *Edit config…*). Saran: nyalakan *auto-hide taskbar* Windows biar dock-nya bisa nempel di bawah.

---

## License
MIT. Not affiliated with Apple or Microsoft.
