# FrostShell system controls — persistent line-based JSON RPC over stdin/stdout.
# in : {"id":1,"cmd":"state"} | setVolume{value 0-1} | setMute{value} | setBrightness{value 0-100}
#      setRadio{kind:"WiFi"|"Bluetooth", on} | setAirplane{on} | setLowPower{on} | setDnd{on}
# out: {"id":1,"ok":true,"state":{...}}   (the full state after every command)
# The loop ends when stdin closes, so it never outlives FrostShell.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
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

function Invoke-Cmd($req) {
  switch ($req.cmd) {
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
  try { Invoke-Cmd $req } catch { $res.ok = $false; $res.error = "$_" }
  $res.state = Get-State
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
