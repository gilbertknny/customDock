# FrostShell media bridge — talks to Windows' Global System Media Transport Controls (SMTC).
# Mode "watch": prints one JSON line whenever the now-playing state changes.
# Mode "cmd":   sends toggle | next | prev to the current media session and exits.
param(
  [string]$Mode = 'watch',
  [string]$Cmd = '',
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
  ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $mgr) { exit 1 }

if ($Mode -eq 'cmd') {
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $op = $null
    switch ($Cmd) {
      'toggle' { $op = $s.TryTogglePlayPauseAsync() }
      'next'   { $op = $s.TrySkipNextAsync() }
      'prev'   { $op = $s.TrySkipPreviousAsync() }
    }
    if ($op) { $null = Await $op ([bool]) }
  }
  exit 0
}

function Get-Art($props) {
  if (-not $props.Thumbnail) { return $null }
  try {
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    $type = if ($stream.ContentType) { $stream.ContentType } else { 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
  } catch { return $null }
}

$lastKey = $null
$prev = ''
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }

  $out = [ordered]@{ active = $false }
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $key = "$($p.Title)|$($p.Artist)|$($s.SourceAppUserModelId)"
    $out = [ordered]@{
      active   = $true
      key      = $key
      title    = "$($p.Title)"
      artist   = "$($p.Artist)"
      album    = "$($p.AlbumTitle)"
      app      = "$($s.SourceAppUserModelId)"
      playing  = ("$($info.PlaybackStatus)" -eq 'Playing')
      position = [math]::Round($tl.Position.TotalSeconds)
      duration = [math]::Round($tl.EndTime.TotalSeconds)
    }
    if ($key -ne $lastKey) {
      $lastKey = $key
      $out.art = Get-Art $p
    }
  } else {
    $lastKey = $null
  }

  $json = $out | ConvertTo-Json -Compress
  if ($json -ne $prev) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $prev = $json
  }
  Start-Sleep -Milliseconds 900
}
