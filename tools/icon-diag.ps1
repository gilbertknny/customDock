# FrostShell icon diagnostics. Writes PNGs + a JSON report to .diag\ next to this repo.
# Run from the repo folder:  powershell -ExecutionPolicy Bypass -File tools\icon-diag.ps1
# Nothing is changed on the system; it only reads icons and app info.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root '.diag'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class DiagIcon {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
  public static int Count(string file) { return (int)PrivateExtractIcons(file, 0, 0, 0, null, null, 0, 0); }
  public static Bitmap Get(string file, int index, int size) {
    var h = new IntPtr[1]; var id = new uint[1];
    uint n = PrivateExtractIcons(file, index, size, size, h, id, 1, 0);
    if (n == 0 || n == uint.MaxValue || h[0] == IntPtr.Zero) return null;
    try { return Icon.FromHandle(h[0]).ToBitmap(); } finally { DestroyIcon(h[0]); }
  }
}
"@

# 1) contact sheets of the system icon libraries (numbered), to find the Windows logo
function Save-Sheet($file, $name) {
  $n = [DiagIcon]::Count($file)
  if ($n -le 0) { return "no icons in $file" }
  $cols = 20; $cell = 64; $rows = [math]::Ceiling($n / $cols)
  $bmp = New-Object System.Drawing.Bitmap ($cols * $cell), ($rows * $cell)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(40, 40, 46))
  $font = New-Object System.Drawing.Font 'Segoe UI', 7
  for ($i = 0; $i -lt $n; $i++) {
    $x = ($i % $cols) * $cell; $y = [math]::Floor($i / $cols) * $cell
    $ic = [DiagIcon]::Get($file, $i, 40)
    if ($ic) { $g.DrawImage($ic, $x + 12, $y + 4, 40, 40); $ic.Dispose() }
    $g.DrawString("$i", $font, [System.Drawing.Brushes]::White, $x + 2, $y + 48)
  }
  $bmp.Save((Join-Path $out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return "$n icons"
}

$report = [ordered]@{}
$sys = Join-Path $env:WINDIR 'SystemResources'
$report.imageres = Save-Sheet (Join-Path $sys 'imageres.dll.mun') 'sheet-imageres'
$report.shell32 = Save-Sheet (Join-Path $sys 'shell32.dll.mun') 'sheet-shell32'
$report.winver = Save-Sheet (Join-Path $env:WINDIR 'System32\winver.exe') 'sheet-winver'
$wm = Join-Path $sys 'winver.exe.mun'
if (Test-Path $wm) { $report.winverMun = Save-Sheet $wm 'sheet-winver-mun' }

# 2) Start menu host package logos
$start = Get-AppxPackage -Name 'Microsoft.Windows.StartMenuExperienceHost' | Select-Object -First 1
if ($start) {
  $report.startHost = $start.InstallLocation
  $i = 0
  Get-ChildItem -LiteralPath $start.InstallLocation -Recurse -Include *.png | Where-Object { $_.Length -lt 200kb } | Select-Object -First 40 | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $out ("start-{0:D2}-{1}" -f $i++, $_.Name))
  }
}

# 3) apps related to the generic icons in the dock
$report.startApps = @(Get-StartApps | Where-Object { $_.Name -match 'Terminal|Notepad|PowerShell|Store|Defender|Security' } | Select-Object Name, AppID)
$report.packages = @(Get-AppxPackage | Where-Object { $_.Name -match 'WindowsTerminal|WindowsNotepad|WindowsStore' } | Select-Object Name, PackageFamilyName)
foreach ($p in @("$env:APPDATA\frostshell\config.json", "$env:APPDATA\FrostShell\config.json")) {
  if (Test-Path $p) { $report.dockItems = (Get-Content $p -Raw | ConvertFrom-Json).dock.items; break }
}
$report.windows = [Environment]::OSVersion.Version.ToString()

$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $out 'report.json')
Write-Host "Done. Results are in $out" -ForegroundColor Green
