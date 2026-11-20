# FrostShell shell watcher — one lightweight loop that:
#   * reports when a fullscreen app/game/presentation is in front   {"t":"fullscreen","v":true}
#   * reports volume / mute / brightness changes (hardware keys)     {"t":"volume","v":0.42,"m":false} / {"t":"brightness","v":70}
#   * optionally keeps the Windows taskbar hidden (-HideTaskbar 1)   {"t":"taskbar","autohide":false}
# The taskbar is ALWAYS restored when this script ends normally (FrostShell quits, crashes,
# or the option is switched off). -Restore runs only the restore step.
param(
  [int]$ParentPid = 0,
  [int]$HideTaskbar = 0,
  [switch]$Restore,
  [int]$WasAutoHide = 0
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class FrostShellWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA {
    public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

  static List<IntPtr> Taskbars() {
    var list = new List<IntPtr>();
    IntPtr h = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null);
    if (h != IntPtr.Zero) list.Add(h);
    IntPtr s = IntPtr.Zero;
    while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) list.Add(s);
    return list;
  }

  public static bool GetAutoHide() {
    var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
    return (SHAppBarMessage(4 /*ABM_GETSTATE*/, ref d).ToUInt32() & 1 /*ABS_AUTOHIDE*/) != 0;
  }
  public static void SetAutoHide(bool on) {
    var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
    d.hWnd = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null);
    d.lParam = (IntPtr)(on ? 1 : 2 /*ABS_ALWAYSONTOP*/);
    SHAppBarMessage(10 /*ABM_SETSTATE*/, ref d);
  }
  // hide every taskbar that is visible again (Explorer likes to bring it back)
  public static void HideTaskbars() { foreach (var h in Taskbars()) if (IsWindowVisible(h)) ShowWindow(h, 0 /*SW_HIDE*/); }
  public static void ShowTaskbars() { foreach (var h in Taskbars()) ShowWindow(h, 5 /*SW_SHOW*/); }

  // 2 = busy (fullscreen app), 3 = D3D fullscreen game, 4 = presentation mode, 7 = fullscreen Store app
  public static bool Fullscreen() {
    int s; if (SHQueryUserNotificationState(out s) != 0) return false;
    return s == 2 || s == 3 || s == 4 || s == 7;
  }
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IWatchEndpointVolume {
  int f(); int g(); int h(); int i(); int j(); int k();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int l(); int m(); int n(); int o(); int p();
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IWatchDevice { int Activate(ref Guid id, int clsCtx, int p, out IWatchEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IWatchEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IWatchDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class WatchEnumeratorCom { }

public static class FrostWatchAudio {
  // re-resolved every call so switching output device (headphones, HDMI) just works
  public static string Read() {
    try {
      var e = new WatchEnumeratorCom() as IWatchEnumerator;
      IWatchDevice dev; if (e.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return null;
      IWatchEndpointVolume v; var id = typeof(IWatchEndpointVolume).GUID;
      if (dev.Activate(ref id, 23, 0, out v) != 0) return null;
      float level; bool mute; v.GetMasterVolumeLevelScalar(out level); v.GetMute(out mute);
      return Math.Round(level, 3).ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + (mute ? "1" : "0");
    } catch { return null; }
  }
}
"@

function Restore-Taskbar([bool]$autoHide) {
  [FrostShellWin]::ShowTaskbars()
  [FrostShellWin]::SetAutoHide($autoHide)
}

if ($Restore) { Restore-Taskbar ([bool]$WasAutoHide); exit 0 }

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$origAutoHide = [FrostShellWin]::GetAutoHide()
if ($HideTaskbar) {
  Emit @{ t = 'taskbar'; autohide = $origAutoHide }
  # auto-hide frees the reserved strip at the bottom (so maximized windows use it);
  # hiding the window stops it from popping up when the cursor touches the edge
  [FrostShellWin]::SetAutoHide($true)
}

$lastFs = $null; $lastVol = $null; $lastBri = $null; $tick = 0
try {
  while ($true) {
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }

    if ($HideTaskbar) { [FrostShellWin]::HideTaskbars() }

    $fs = [FrostShellWin]::Fullscreen()
    if ($fs -ne $lastFs) { $lastFs = $fs; Emit @{ t = 'fullscreen'; v = $fs } }

    $vol = [FrostWatchAudio]::Read()
    if ($vol -and $vol -ne $lastVol) {
      $lastVol = $vol
      $parts = $vol.Split('|')
      Emit @{ t = 'volume'; v = [double]::Parse($parts[0], [Globalization.CultureInfo]::InvariantCulture); m = ($parts[1] -eq '1') }
    }

    if ($tick % 3 -eq 0) {   # brightness via WMI is slower, check every ~0.75 s
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
      if ($b -and [int]$b.CurrentBrightness -ne $lastBri) { $lastBri = [int]$b.CurrentBrightness; Emit @{ t = 'brightness'; v = $lastBri } }
    }

    $tick++
    Start-Sleep -Milliseconds 250
  }
} finally {
  if ($HideTaskbar) { Restore-Taskbar $origAutoHide }
}
