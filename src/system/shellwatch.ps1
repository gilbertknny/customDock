# FrostShell shell watcher — one lightweight loop that:
#   * reports when a fullscreen app/game/presentation is in front   {"t":"fullscreen","v":true}
#   * reports volume / mute / brightness changes (hardware keys)     {"t":"volume","v":0.42,"m":false} / {"t":"brightness","v":70}
#   * optionally keeps the Windows taskbar hidden (-HideTaskbar 1)   {"t":"taskbar","autohide":false}
#   * lists open app windows (like the taskbar does)                 {"t":"windows","list":[...]}
# stdin commands (one JSON per line): {"cmd":"activate","hwnds":[..]} | {"cmd":"close","hwnds":[..]} | {"cmd":"start"}
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
using System.Text;

// ---- open app windows (what the taskbar would show) ----
[StructLayout(LayoutKind.Sequential, Pack = 4)] public struct FrostPropKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Sequential)] public struct FrostPropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFrostPropertyStore {
  [PreserveSig] int GetCount(out uint c);
  [PreserveSig] int GetAt(uint i, out FrostPropKey k);
  [PreserveSig] int GetValue(ref FrostPropKey k, out FrostPropVariant v);
  [PreserveSig] int SetValue(ref FrostPropKey k, ref FrostPropVariant v);
  [PreserveSig] int Commit();
}

public class FrostWin { public long Hwnd; public int Pid; public string Path; public string Aumid; public string Title; }

public static class FrostWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder sb, ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, out IFrostPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref FrostPropVariant v);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

  static readonly HashSet<string> SkipClass = new HashSet<string> {
    "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland"
  };

  static string ProcPath(int pid) {
    IntPtr h = OpenProcess(0x1000 /*QUERY_LIMITED_INFORMATION*/, false, pid);
    if (h == IntPtr.Zero) return null;
    try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : null; }
    finally { CloseHandle(h); }
  }

  static string Aumid(IntPtr h) {
    try {
      Guid iid = typeof(IFrostPropertyStore).GUID; IFrostPropertyStore store;
      if (SHGetPropertyStoreForWindow(h, ref iid, out store) != 0 || store == null) return null;
      var key = new FrostPropKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
      FrostPropVariant v;
      if (store.GetValue(ref key, out v) != 0) return null;
      try { return v.vt == 31 /*VT_LPWSTR*/ ? Marshal.PtrToStringUni(v.p) : null; }
      finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
    } catch { return null; }
  }

  public static FrostWin[] List(int skipPid) {
    var list = new List<FrostWin>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4 /*GW_OWNER*/) != IntPtr.Zero) return true;
      int ex = GetWindowLong(h, -20 /*GWL_EXSTYLE*/);
      if ((ex & 0x08000000) != 0) return true;                        // WS_EX_NOACTIVATE (docks, overlays)
      if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;       // tool window without APPWINDOW
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      if (SkipClass.Contains(cls.ToString())) return true;
      var title = new StringBuilder(512); GetWindowText(h, title, 512);
      if (title.Length == 0) return true;
      int pid; GetWindowThreadProcessId(h, out pid);
      if (pid == skipPid) return true;
      // Store apps live inside ApplicationFrameHost; the real process owns the CoreWindow child
      if (cls.ToString() == "ApplicationFrameWindow") {
        IntPtr core = FindWindowEx(h, IntPtr.Zero, "Windows.UI.Core.CoreWindow", null);
        if (core != IntPtr.Zero) { int cp; GetWindowThreadProcessId(core, out cp); pid = cp; }
      }
      list.Add(new FrostWin { Hwnd = h.ToInt64(), Pid = pid, Path = ProcPath(pid), Aumid = Aumid(h), Title = title.ToString() });
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  public static void Activate(IntPtr h) {
    if (!IsWindow(h)) return;
    if (IsIconic(h)) ShowWindow(h, 9 /*SW_RESTORE*/);
    IntPtr fg = GetForegroundWindow();
    int dummy;
    uint fgThread = GetWindowThreadProcessId(fg, out dummy), me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    if (GetForegroundWindow() != h) SwitchToThisWindow(h, true); // foreground lock fallback
  }

  // dock click: bring app forward; already in front -> next window, or minimize if it's the only one
  public static void ActivateGroup(long[] hwnds) {
    if (hwnds == null || hwnds.Length == 0) return;
    long fg = GetForegroundWindow().ToInt64();
    int idx = Array.IndexOf(hwnds, fg);
    if (idx < 0) Activate(new IntPtr(hwnds[0]));
    else if (hwnds.Length > 1) Activate(new IntPtr(hwnds[(idx + 1) % hwnds.Length]));
    else ShowWindow(new IntPtr(fg), 6 /*SW_MINIMIZE*/);
  }

  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // same as pressing the Windows key: opens/closes Start
  public static void OpenStart() {
    keybd_event(0x5B /*VK_LWIN*/, 0, 0, UIntPtr.Zero);
    keybd_event(0x5B, 0, 2 /*KEYUP*/, UIntPtr.Zero);
  }

  public static void Close(long[] hwnds) {
    foreach (var h in hwnds) PostMessage(new IntPtr(h), 0x0010 /*WM_CLOSE*/, IntPtr.Zero, IntPtr.Zero);
  }
}

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

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }

$origAutoHide = [FrostShellWin]::GetAutoHide()
if ($HideTaskbar) {
  Emit @{ t = 'taskbar'; autohide = $origAutoHide }
  # auto-hide frees the reserved strip at the bottom (so maximized windows use it);
  # hiding the window stops it from popping up when the cursor touches the edge
  [FrostShellWin]::SetAutoHide($true)
}

$lastFs = $null; $lastVol = $null; $lastBri = $null; $lastWin = ''; $tick = 0
$descCache = @{}
function Get-Desc($path) {
  if (-not $path) { return $null }
  if (-not $descCache.ContainsKey($path)) {
    $d = $null
    try { $d = ([Diagnostics.FileVersionInfo]::GetVersionInfo($path)).FileDescription } catch {}
    $descCache[$path] = $d
  }
  $descCache[$path]
}

function Invoke-WatchCmd($line) {
  try { $c = $line | ConvertFrom-Json } catch { return }
  $h = [long[]]@($c.hwnds | ForEach-Object { [long]$_ })
  switch ($c.cmd) {
    'activate' { [FrostWindows]::ActivateGroup($h) }
    'close' { [FrostWindows]::Close($h) }
    'start' { [FrostWindows]::OpenStart() }
  }
  $script:lastWin = '' # re-emit soon so the dock reflects it
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$readTask = $stdin.ReadLineAsync()
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

    if ($tick % 2 -eq 0) {   # open windows, ~2x per second
      $wins = [FrostWindows]::List($ParentPid)
      $sig = ($wins | ForEach-Object { "$($_.Hwnd)|$($_.Path)|$($_.Aumid)" }) -join ';'
      if ($sig -ne $lastWin) {
        $lastWin = $sig
        Emit @{ t = 'windows'; list = @($wins | ForEach-Object {
              [ordered]@{ hwnd = $_.Hwnd; pid = $_.Pid; path = $_.Path; aumid = $_.Aumid; title = $_.Title; desc = (Get-Desc $_.Path) }
            }) }
      }
    }

    $tick++
    # wait up to 250 ms, but wake immediately when a command arrives (snappy dock clicks)
    if ($readTask.Wait(250)) {
      $line = $readTask.Result
      if ($null -eq $line) { break }  # stdin closed: FrostShell is gone
      Invoke-WatchCmd $line
      $readTask = $stdin.ReadLineAsync()
    }
  }
} finally {
  if ($HideTaskbar) { Restore-Taskbar $origAutoHide }
}
