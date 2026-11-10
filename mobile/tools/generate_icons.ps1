# Generates the Nobogent app icon, adaptive icon and splash from the REAL brand
# asset — `assets/brand/nobogent-logo.png` — rather than a re-drawn approximation.
#
# The source logo is a violet/orange dotted orb above a "nobogent.com" wordmark.
# The launcher icon uses just the orb (cropped programmatically to its saturated
# bounds, so it cannot drift if the artwork changes); the splash uses the full
# lockup on white, which is what the web app uses for its own launch screen.
#
# Usage: pwsh -File tools/generate_icons.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$androidRes = Join-Path $root 'android\app\src\main\res'
$iosIconSet = Join-Path $root 'ios\Runner\Assets.xcassets\AppIcon.appiconset'
$brandDir = Join-Path $root 'assets\brand'
$logoPath = Join-Path $brandDir 'nobogent-logo.png'

if (-not (Test-Path $logoPath)) { Write-Error "Missing $logoPath"; exit 1 }

$source = [System.Drawing.Bitmap]::FromFile($logoPath)
Write-Output ("source logo: {0}x{1}" -f $source.Width, $source.Height)

# --- 1. Find the orb (the saturated part of the artwork) --------------------
$minX = $source.Width; $minY = $source.Height; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
        $c = $source.GetPixel($x, $y)
        $mx = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
        $mn = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
        # Saturation separates the violet/orange orb from the black wordmark.
        if (($mx - $mn) -gt 40) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$side = [Math]::Max($maxX - $minX, $maxY - $minY)
$pad = [int]($side * 0.06)
$cx = [int](($minX + $maxX) / 2)
$cy = [int](($minY + $maxY) / 2)
$half = [int]($side / 2) + $pad
$orbRect = New-Object System.Drawing.Rectangle(
    ($cx - $half), ($cy - $half), ($half * 2), ($half * 2)
)
if ($orbRect.X -lt 0) { $orbRect.X = 0 }
if ($orbRect.Y -lt 0) { $orbRect.Y = 0 }
if ($orbRect.Right -gt $source.Width) { $orbRect.Width = $source.Width - $orbRect.X }
if ($orbRect.Bottom -gt $source.Height) { $orbRect.Height = $source.Height - $orbRect.Y }
Write-Output ("orb crop: {0}x{1} at {2},{3}" -f $orbRect.Width, $orbRect.Height, $orbRect.X, $orbRect.Y)

function Save-Resized([System.Drawing.Bitmap]$src, [System.Drawing.Rectangle]$crop, [int]$size, [string]$path, [System.Drawing.Color]$bg, [double]$fill = 1.0) {
    $out = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($bg.A -gt 0) {
        $brush = New-Object System.Drawing.SolidBrush($bg)
        $g.FillRectangle($brush, 0, 0, $size, $size)
        $brush.Dispose()
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }
    $inner = [int]($size * $fill)
    $offset = [int](($size - $inner) / 2)
    $dest = New-Object System.Drawing.Rectangle($offset, $offset, $inner, $inner)
    $g.DrawImage($src, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
}

function Save-Lockup([System.Drawing.Bitmap]$src, [int]$width, [string]$path) {
    $ratio = $src.Height / $src.Width
    $height = [int]($width * $ratio)
    $out = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($src, 0, 0, $width, $height)
    $g.Dispose()
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
}

$white = [System.Drawing.Color]::White
$clear = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

Write-Output '== master icon (white plate, real orb) =='
Save-Resized $source $orbRect 1024 (Join-Path $brandDir 'app_icon_1024.png') $white 0.86
Write-Output '   assets/brand/app_icon_1024.png'

Write-Output '== Android launcher icons =='
$androidSizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($d in $androidSizes.Keys) {
    Save-Resized $source $orbRect $androidSizes[$d] (Join-Path $androidRes "mipmap-$d\ic_launcher.png") $white 0.86
    Write-Output "   mipmap-$d/ic_launcher.png"
}

Write-Output '== Android adaptive foreground (transparent, inside safe zone) =='
$adaptiveSizes = @{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
foreach ($d in $adaptiveSizes.Keys) {
    $dir = Join-Path $androidRes "mipmap-$d"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    # 0.62 keeps the mark inside the 66% adaptive-icon safe zone.
    Save-Resized $source $orbRect $adaptiveSizes[$d] (Join-Path $dir 'ic_launcher_foreground.png') $clear 0.62
    Write-Output "   mipmap-$d/ic_launcher_foreground.png"
}

Write-Output '== splash lockup (full logo on white, as the web app launches) =='
Save-Lockup $source 720 (Join-Path $androidRes 'drawable-nodpi\splash_logo.png')
Write-Output '   drawable-nodpi/splash_logo.png'

Write-Output '== iOS app icons =='
$iosSizes = [ordered]@{
    'Icon-App-20x20@1x.png'     = 20
    'Icon-App-20x20@2x.png'     = 40
    'Icon-App-20x20@3x.png'     = 60
    'Icon-App-29x29@1x.png'     = 29
    'Icon-App-29x29@2x.png'     = 58
    'Icon-App-29x29@3x.png'     = 87
    'Icon-App-40x40@1x.png'     = 40
    'Icon-App-40x40@2x.png'     = 80
    'Icon-App-40x40@3x.png'     = 120
    'Icon-App-60x60@2x.png'     = 120
    'Icon-App-60x60@3x.png'     = 180
    'Icon-App-76x76@1x.png'     = 76
    'Icon-App-76x76@2x.png'     = 152
    'Icon-App-83.5x83.5@2x.png' = 167
    'Icon-App-1024x1024@1x.png' = 1024
}
foreach ($name in $iosSizes.Keys) {
    Save-Resized $source $orbRect $iosSizes[$name] (Join-Path $iosIconSet $name) $white 0.86
    Write-Output "   $name"
}

$source.Dispose()
Write-Output '== Done =='
