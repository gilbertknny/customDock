# FrostShell icon extractor — returns the real Windows icons, as large as available.
# stdin : JSON array of requests  [{ "key": "...", "candidates": [ {kind,...}, ... ] }]
#         kind "file" -> { file, index }   icon resource from .exe/.dll/.ico (index < 0 = resource id)
#         kind "shell"-> { path }          whatever Explorer shows for a shell item:
#                                          shell:AppsFolder\<AUMID>, shell:RecycleBinFolder, any file/folder
#         kind "appx" -> { family, app }   Microsoft Store / UWP app logo from its manifest
# stdout: JSON object { key: "data:image/png;base64,..." }  (first candidate that works wins)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory {
  [PreserveSig] int GetImage(FrostSize size, int flags, out IntPtr phbm);
}
[StructLayout(LayoutKind.Sequential)] public struct FrostSize { public int cx; public int cy; }
[StructLayout(LayoutKind.Sequential)] public struct FrostBitmap {
  public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes;
  public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits;
}
[StructLayout(LayoutKind.Sequential)] public struct FrostBmiHeader {
  public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount;
  public int biCompression; public int biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
  public int biClrUsed; public int biClrImportant;
}

public static class FrostShellIcon {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out FrostBitmap bm);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, byte[] bits, ref FrostBmiHeader bmi, uint usage);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);

  // Same icon Explorer / Start show for the item, with real alpha. null on failure.
  public static byte[] Png(string path, int size) {
    Guid iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory f;
    if (SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out f) != 0 || f == null) return null;
    IntPtr hbm;
    // SIIGBF_BIGGERSIZEOK (0x1) | SIIGBF_ICONONLY (0x4): never a file thumbnail
    if (f.GetImage(new FrostSize { cx = size, cy = size }, 0x1 | 0x4, out hbm) != 0 || hbm == IntPtr.Zero) return null;
    try {
      FrostBitmap bm;
      GetObject(hbm, Marshal.SizeOf(typeof(FrostBitmap)), out bm);
      int w = bm.bmWidth, h = bm.bmHeight;
      if (w <= 0 || h <= 0) return null;
      var bmi = new FrostBmiHeader { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
      byte[] px = new byte[w * h * 4];
      IntPtr dc = GetDC(IntPtr.Zero);
      int got = GetDIBits(dc, hbm, 0, (uint)h, px, ref bmi, 0);
      ReleaseDC(IntPtr.Zero, dc);
      if (got == 0) return null;
      bool anyAlpha = false;
      for (int i = 3; i < px.Length; i += 4) if (px[i] != 0) { anyAlpha = true; break; }
      if (!anyAlpha) for (int i = 3; i < px.Length; i += 4) px[i] = 255; // 24-bit icon: make opaque
      using (var b = new Bitmap(w, h, PixelFormat.Format32bppPArgb)) {
        var data = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        b.UnlockBits(data);
        using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return ms.ToArray(); }
      }
    } finally { DeleteObject(hbm); }
  }
}

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

function Get-ShellIcon($path) {
  $p = [Environment]::ExpandEnvironmentVariables($path)
  foreach ($size in 256, 96) {
    try { $bytes = [FrostShellIcon]::Png($p, $size) } catch { $bytes = $null }
    if ($bytes) { return ToDataUrl $bytes }
  }
  return $null
}

$requests = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = @{}
foreach ($req in @($requests)) {
  foreach ($c in @($req.candidates)) {
    $url = $null
    if ($c.kind -eq 'file') { $url = Get-FileIcon $c.file ([int]$c.index) }
    elseif ($c.kind -eq 'shell') { $url = Get-ShellIcon $c.path }
    elseif ($c.kind -eq 'appx') { $url = Get-AppxIcon $c.family $c.app }
    if ($url) { $out[$req.key] = $url; break }
  }
}
[Console]::Out.Write(($out | ConvertTo-Json -Compress))
