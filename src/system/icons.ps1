# FrostShell icon extractor — returns the real Windows icons, as large as available.
# stdin : JSON array of requests  [{ "key": "...", "candidates": [ {kind,...}, ... ] }]
#         kind "file" -> { file, index }   icon resource from .exe/.dll/.ico (index < 0 = resource id)
#         kind "appx" -> { family, app }   Microsoft Store / UWP app logo from its manifest
# stdout: JSON object { key: "data:image/png;base64,..." }  (first candidate that works wins)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FrostIcon {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr handle);
}
"@

function ToDataUrl([byte[]]$bytes) { 'data:image/png;base64,' + [Convert]::ToBase64String($bytes) }

function Get-FileIcon($file, [int]$index) {
  $file = [Environment]::ExpandEnvironmentVariables($file)
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  foreach ($size in 256, 128, 64, 48) {
    $h = New-Object IntPtr[] 1
    $id = New-Object uint32[] 1
    $n = [FrostIcon]::PrivateExtractIcons($file, $index, $size, $size, $h, $id, 1, 0)
    if ($n -gt 0 -and $n -ne [uint32]::MaxValue -and $h[0] -ne [IntPtr]::Zero) {
      try {
        $bmp = ([System.Drawing.Icon]::FromHandle($h[0])).ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        return ToDataUrl $ms.ToArray()
      } finally { [void][FrostIcon]::DestroyIcon($h[0]) }
    }
  }
  return $null
}

$script:packages = $null
function Get-AppxIcon($family, $appId) {
  if (-not $script:packages) { $script:packages = @(Get-AppxPackage) }
  $pkg = $script:packages | Where-Object { $_.PackageFamilyName -ieq $family } | Select-Object -First 1
  if (-not $pkg) { return $null }
  $loc = $pkg.InstallLocation
  [xml]$manifest = Get-Content -LiteralPath (Join-Path $loc 'AppxManifest.xml') -Raw
  $apps = @($manifest.Package.Applications.Application)
  $app = $null
  if ($appId) { $app = $apps | Where-Object { $_.Id -ieq $appId } | Select-Object -First 1 }
  if (-not $app) { $app = $apps[0] }
  $ve = $app.VisualElements
  $logo = if ($ve.Square44x44Logo) { $ve.Square44x44Logo } else { $ve.Square150x150Logo }
  if (-not $logo) { return $null }

  $base = Join-Path $loc $logo
  $dir = Split-Path $base
  $name = [IO.Path]::GetFileNameWithoutExtension($base)
  $ext = [IO.Path]::GetExtension($base)
  $best = $null; $bestScore = -1
  foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.Name -like "$name*$ext" }) {
    $n = $f.FullName
    if ($n -match 'contrast-') { continue }              # skip high-contrast variants
    $score = 10
    if ($n -match 'targetsize-(\d+)') { $score = [int]$matches[1] }
    elseif ($n -match 'scale-(\d+)') { $score = [int]$matches[1] * 0.44 }
    if ($score -gt 256) { $score = 256 - ($score - 256) / 10 }
    if ($n -match 'altform-unplated') { $score += 0.5 }    # transparent background
    if ($n -match 'altform-lightunplated') { $score -= 0.3 }
    if ($score -gt $bestScore) { $bestScore = $score; $best = $n }
  }
  if (-not $best -and (Test-Path -LiteralPath $base)) { $best = $base }
  if (-not $best) { return $null }
  return ToDataUrl ([IO.File]::ReadAllBytes($best))
}

$requests = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = @{}
foreach ($req in @($requests)) {
  foreach ($c in @($req.candidates)) {
    $url = $null
    if ($c.kind -eq 'file') { $url = Get-FileIcon $c.file ([int]$c.index) }
    elseif ($c.kind -eq 'appx') { $url = Get-AppxIcon $c.family $c.app }
    if ($url) { $out[$req.key] = $url; break }
  }
}
[Console]::Out.Write(($out | ConvertTo-Json -Compress))
