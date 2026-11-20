# FrostShell system controls — persistent line-based JSON RPC over stdin/stdout.
# in : {"id":1,"cmd":"state"} | setVolume{value 0-1} | setMute{value} | setBrightness{value 0-100}
#      wifiList{scan} | wifiConnect{ssid,password?} | wifiDisconnect | wifiForget{profile}
#      setRadio{kind:"WiFi"|"Bluetooth", on} | setAirplane{on} | setLowPower{on} | setDnd{on}
# out: {"id":1,"ok":true,"state":{...}}   (the full state after every command)
# The loop ends when stdin closes, so it never outlives FrostShell.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class FrostAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
  }
  public static bool Mute {
    get { bool mute; Marshal.ThrowExceptionForHR(Vol().GetMute(out mute)); return mute; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
  }
}

// Native Wi-Fi (wlanapi.dll): locale-independent, no shell quoting of SSIDs/passwords.
public class FrostWifiNet {
  public string Ssid; public int Signal; public bool Secure; public string Auth;
  public bool Connected; public bool Saved; public string Profile;
}

public static class FrostWifi {
  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint ver, IntPtr res, out uint negotiated, out IntPtr handle);
  [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr h, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid iface, uint flags, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanSetProfile(IntPtr h, ref Guid iface, uint flags, string xml, string sec, bool overwrite, IntPtr res, out uint reason);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanDeleteProfile(IntPtr h, ref Guid iface, string name, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr h, ref Guid iface, ref ConnParams p, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr h, ref Guid iface, IntPtr res);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct ConnParams {
    public int mode; [MarshalAs(UnmanagedType.LPWStr)] public string profile;
    public IntPtr ssid; public IntPtr bssids; public int bssType; public uint flags;
  }

  public class WifiError : Exception { public int Code; public WifiError(int c) : base("wlan error " + c) { Code = c; } }
  static void Check(int r) { if (r != 0) throw new WifiError(r); }

  static IntPtr Open() { uint v; IntPtr h; Check(WlanOpenHandle(2, IntPtr.Zero, out v, out h)); return h; }

  static Guid Iface(IntPtr h) {
    IntPtr list; Check(WlanEnumInterfaces(h, IntPtr.Zero, out list));
    try {
      if (Marshal.ReadInt32(list, 0) == 0) throw new WifiError(-1); // no Wi-Fi adapter
      byte[] g = new byte[16]; Marshal.Copy(new IntPtr(list.ToInt64() + 8), g, 0, 16);
      return new Guid(g);
    } finally { WlanFreeMemory(list); }
  }

  static string AuthKind(int algo) {
    switch (algo) {
      case 1: return "open";
      case 4: case 7: case 9: return "personal";   // WPA-PSK, WPA2-PSK, WPA3-SAE
      default: return "enterprise";               // 802.1X, OWE, WEP: hand off to Settings
    }
  }

  // WLAN_AVAILABLE_NETWORK is 628 bytes; fields read by offset to avoid marshaling quirks
  static List<FrostWifiNet> Raw(IntPtr h, Guid g, List<int> algos, List<int> ciphers) {
    IntPtr list; Check(WlanGetAvailableNetworkList(h, ref g, 0, IntPtr.Zero, out list));
    var byName = new Dictionary<string, FrostWifiNet>();
    var order = new List<FrostWifiNet>();
    try {
      int n = Marshal.ReadInt32(list, 0);
      for (int i = 0; i < n; i++) {
        long b = list.ToInt64() + 8 + (long)i * 628;
        string profile = Marshal.PtrToStringUni(new IntPtr(b));
        int len = Math.Min(32, Marshal.ReadInt32(new IntPtr(b + 512)));
        byte[] raw = new byte[len]; Marshal.Copy(new IntPtr(b + 516), raw, 0, len);
        string ssid = System.Text.Encoding.UTF8.GetString(raw);
        if (ssid.Length == 0) continue; // hidden network
        int signal = Marshal.ReadInt32(new IntPtr(b + 604));
        bool secure = Marshal.ReadInt32(new IntPtr(b + 608)) != 0;
        int algo = Marshal.ReadInt32(new IntPtr(b + 612));
        int cipher = Marshal.ReadInt32(new IntPtr(b + 616));
        int flags = Marshal.ReadInt32(new IntPtr(b + 620));
        FrostWifiNet net;
        if (!byName.TryGetValue(ssid, out net)) {
          net = new FrostWifiNet { Ssid = ssid, Secure = secure, Auth = AuthKind(algo) };
          byName[ssid] = net; order.Add(net);
          if (algos != null) { algos.Add(algo); ciphers.Add(cipher); }
        }
        net.Signal = Math.Max(net.Signal, signal);
        if ((flags & 1) != 0) net.Connected = true;
        if ((flags & 2) != 0 && !string.IsNullOrEmpty(profile)) { net.Saved = true; net.Profile = profile; }
      }
    } finally { WlanFreeMemory(list); }
    return order;
  }

  public static FrostWifiNet[] List(bool scan) {
    IntPtr h = Open();
    try {
      Guid g = Iface(h);
      if (scan) { WlanScan(h, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); System.Threading.Thread.Sleep(2600); }
      var nets = Raw(h, g, null, null);
      nets.Sort((a, b) => a.Connected != b.Connected ? (a.Connected ? -1 : 1) : b.Signal.CompareTo(a.Signal));
      return nets.ToArray();
    } finally { WlanCloseHandle(h, IntPtr.Zero); }
  }

  static string ProfileXml(string ssid, int algo, int cipher, string password) {
    var hex = BitConverter.ToString(System.Text.Encoding.UTF8.GetBytes(ssid)).Replace("-", "");
    string esc = System.Security.SecurityElement.Escape(ssid);
    string auth = algo == 1 ? "open" : algo == 4 ? "WPAPSK" : algo == 9 ? "WPA3SAE" : "WPA2PSK";
    string enc = algo == 1 ? "none" : cipher == 2 ? "TKIP" : "AES";
    string key = algo == 1 ? "" :
      "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>" +
      System.Security.SecurityElement.Escape(password) + "</keyMaterial></sharedKey>";
    return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">" +
      "<name>" + esc + "</name><SSIDConfig><SSID><hex>" + hex + "</hex><name>" + esc + "</name></SSID></SSIDConfig>" +
      "<connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption>" +
      "<authentication>" + auth + "</authentication><encryption>" + enc + "</encryption><useOneX>false</useOneX>" +
      "</authEncryption>" + key + "</security></MSM></WLANProfile>";
  }

  // ok | needpassword | password | failed | enterprise | notfound
  public static string Connect(string ssid, string password) {
    IntPtr h = Open();
    try {
      Guid g = Iface(h);
      var algos = new List<int>(); var ciphers = new List<int>();
      var nets = Raw(h, g, algos, ciphers);
      int idx = nets.FindIndex(x => x.Ssid == ssid);
      if (idx < 0) return "notfound";
      var net = nets[idx];
      if (net.Connected && string.IsNullOrEmpty(password)) return "ok";
      if (net.Auth == "enterprise") return "enterprise";
      string profile = net.Profile;
      bool created = false;
      if (!net.Saved || !string.IsNullOrEmpty(password)) {
        if (net.Secure && string.IsNullOrEmpty(password)) return "needpassword";
        uint reason;
        Check(WlanSetProfile(h, ref g, 0, ProfileXml(ssid, algos[idx], ciphers[idx], password ?? ""), null, true, IntPtr.Zero, out reason));
        created = !net.Saved;
        profile = ssid;
      }
      var p = new ConnParams { mode = 0, profile = profile, bssType = 1 };
      Check(WlanConnect(h, ref g, ref p, IntPtr.Zero));
      for (int t = 0; t < 30; t++) {
        System.Threading.Thread.Sleep(500);
        var now = Raw(h, g, null, null).Find(x => x.Ssid == ssid);
        if (now != null && now.Connected) return "ok";
      }
      if (created) WlanDeleteProfile(h, ref g, profile, IntPtr.Zero); // don't keep a wrong password
      return net.Secure ? "password" : "failed";
    } finally { WlanCloseHandle(h, IntPtr.Zero); }
  }

  public static void Disconnect() {
    IntPtr h = Open();
    try { Guid g = Iface(h); Check(WlanDisconnect(h, ref g, IntPtr.Zero)); } finally { WlanCloseHandle(h, IntPtr.Zero); }
  }

  public static void Forget(string profile) {
    IntPtr h = Open();
    try { Guid g = Iface(h); Check(WlanDeleteProfile(h, ref g, profile, IntPtr.Zero)); } finally { WlanCloseHandle(h, IntPtr.Zero); }
  }
}

public static class FrostPower {
  [DllImport("powrprof.dll")] public static extern uint PowerSetActiveOverlayScheme(Guid scheme);
  [DllImport("powrprof.dll")] public static extern uint PowerGetEffectiveOverlayScheme(out Guid scheme);
}
"@

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])

$EFFICIENCY = [Guid]'961cc777-2547-4f9d-8174-7d86181b8a7a'   # Power mode: best power efficiency
$BALANCED = [Guid]::Empty
$TOASTS = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$script:beforeAirplane = @{}

function Get-Radios {
  $list = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
    ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  @($list)
}

function Set-Radio($radio, [bool]$on) {
  $state = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  $null = Await ($radio.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])
}

function Get-Wifi {
  $info = @{ ssid = $null; signal = $null; ethernet = $false }
  $wlan = (netsh wlan show interfaces) -join "`n"
  if ($wlan -match '(?m)^\s*SSID\s*:\s*(.+?)\s*$') { $info.ssid = $matches[1] }
  if ($wlan -match ':\s*(\d+)\s*%') { $info.signal = [int]$matches[1] }
  $eth = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -eq '802.3' }
  if ($eth) { $info.ethernet = $true }
  $info
}

function Get-State {
  $s = [ordered]@{}
  try { $s.volume = [math]::Round([FrostAudio]::Volume, 3); $s.muted = [FrostAudio]::Mute } catch { $s.volume = $null; $s.muted = $false }

  $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
  $s.brightness = if ($b) { [int]$b.CurrentBrightness } else { $null }   # null = not supported (desktop monitor)

  $radios = Get-Radios
  $wifi = $radios | Where-Object { "$($_.Kind)" -eq 'WiFi' } | Select-Object -First 1
  $bt = $radios | Where-Object { "$($_.Kind)" -eq 'Bluetooth' } | Select-Object -First 1
  $s.wifi = if ($wifi) { "$($wifi.State)" -eq 'On' } else { $null }
  $s.bluetooth = if ($bt) { "$($bt.State)" -eq 'On' } else { $null }
  $s.airplane = ($radios.Count -gt 0) -and -not ($radios | Where-Object { "$($_.State)" -eq 'On' })

  $net = Get-Wifi
  $s.ssid = $net.ssid
  $s.signal = $net.signal
  $s.ethernet = $net.ethernet

  $g = [Guid]::Empty
  if ([FrostPower]::PowerGetEffectiveOverlayScheme([ref]$g) -eq 0) { $s.lowPower = ($g -eq $EFFICIENCY) } else { $s.lowPower = $null }

  $t = (Get-ItemProperty -Path $TOASTS -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED).NOC_GLOBAL_SETTING_TOASTS_ENABLED
  $s.dnd = ($t -eq 0)
  $s
}

function Get-WifiList([bool]$scan) {
  try {
    $nets = [FrostWifi]::List($scan)
    return @{ networks = @($nets | ForEach-Object {
          [ordered]@{ ssid = $_.Ssid; signal = $_.Signal; secure = $_.Secure; auth = $_.Auth; connected = $_.Connected; saved = $_.Saved; profile = $_.Profile }
        }) }
  } catch {
    $code = $_.Exception.InnerException.Code
    if ($code -eq 5) { return @{ networks = @(); error = 'location' } }      # Windows 11 24H2+: needs Location access
    if ($code -eq -1) { return @{ networks = @(); error = 'noadapter' } }
    if ($code -eq 1062 -or $code -eq 21) { return @{ networks = @(); error = 'off' } } # service stopped / radio off
    return @{ networks = @(); error = 'failed' }
  }
}

function Invoke-Cmd($req) {
  switch ($req.cmd) {
    'wifiList' { $script:wifi = Get-WifiList ([bool]$req.scan) }
    'wifiConnect' {
      try { $r = [FrostWifi]::Connect([string]$req.ssid, [string]$req.password) } catch { $r = 'failed' }
      $script:wifi = Get-WifiList $false
      $script:wifi.result = $r
    }
    'wifiDisconnect' { try { [FrostWifi]::Disconnect() } catch {}; Start-Sleep -Milliseconds 800; $script:wifi = Get-WifiList $false }
    'wifiForget' { try { [FrostWifi]::Forget([string]$req.profile) } catch {}; $script:wifi = Get-WifiList $false }
    'setVolume' { [FrostAudio]::Volume = [float][math]::Max(0, [math]::Min(1, [double]$req.value)); if ([FrostAudio]::Mute -and $req.value -gt 0) { [FrostAudio]::Mute = $false } }
    'setMute' { [FrostAudio]::Mute = [bool]$req.value }
    'setBrightness' {
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
      if ($m) { $null = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][math]::Max(0, [math]::Min(100, [int]$req.value)) } }
    }
    'setRadio' {
      $r = Get-Radios | Where-Object { "$($_.Kind)" -eq $req.kind } | Select-Object -First 1
      if ($r) { Set-Radio $r ([bool]$req.on) }
    }
    'setAirplane' {
      $radios = Get-Radios
      if ($req.on) {
        $script:beforeAirplane = @{}
        foreach ($r in $radios) { $script:beforeAirplane["$($r.Kind)"] = ("$($r.State)" -eq 'On'); Set-Radio $r $false }
      } else {
        foreach ($r in $radios) {
          $k = "$($r.Kind)"
          $restore = if ($script:beforeAirplane.ContainsKey($k)) { $script:beforeAirplane[$k] } else { $true }
          if ($restore) { Set-Radio $r $true }
        }
      }
    }
    'setLowPower' { $null = [FrostPower]::PowerSetActiveOverlayScheme($(if ($req.on) { $EFFICIENCY } else { $BALANCED })) }
    'setDnd' {
      if (-not (Test-Path $TOASTS)) { $null = New-Item -Path $TOASTS -Force }
      Set-ItemProperty -Path $TOASTS -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Value $(if ($req.on) { 0 } else { 1 }) -Type DWord
    }
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $req = $line | ConvertFrom-Json
  $res = [ordered]@{ id = $req.id; ok = $true }
  $script:wifi = $null
  try { Invoke-Cmd $req } catch { $res.ok = $false; $res.error = "$_" }
  if ($script:wifi) { $res.wifi = $script:wifi }
  $res.state = Get-State
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
