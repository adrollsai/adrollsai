# Generates the Nobogent app icon set for Android and iOS.
#
# The mark is drawn programmatically rather than cropped from the wordmark logo,
# so the launcher icon is the same vector geometry the app renders at runtime
# (see lib/core/ui/orbit_mark.dart) — one brand mark, no drift.
#
# Usage: pwsh -File tools/generate_icons.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$androidRes = Join-Path $root 'android\app\src\main\res'
$iosIconSet = Join-Path $root 'ios\Runner\Assets.xcassets\AppIcon.appiconset'
$brandDir = Join-Path $root 'assets\brand'

function New-BrushGradient([System.Drawing.RectangleF]$rect) {
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 0x62, 0x20, 0xD8),
        [System.Drawing.Color]::FromArgb(255, 0x3F, 0x3F, 0xE0),
        45.0
    )
    return $brush
}

# Draws the orbital mark (dotted spiral + ring + core) in white.
function Draw-OrbitMark(
    [System.Drawing.Graphics]$g,
    [float]$cx,
    [float]$cy,
    [float]$markSize,
    [System.Drawing.Color]$color
) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $extent = $markSize / 2.0
    $ink = $markSize / 24.0

    # --- Dotted spiral -----------------------------------------------------
    $total = 58
    for ($i = 0; $i -lt $total; $i++) {
        $t = $i / [double]$total
        $angle = $t * [math]::PI * 2.0 * 1.9
        $band = 0.74 + 0.26 * [math]::Sin($t * [math]::PI)
        $radius = $extent * $band
        $px = $cx + [math]::Cos($angle) * $radius
        $py = $cy + [math]::Sin($angle) * $radius

        $taper = [math]::Sin($t * [math]::PI)
        if ($taper -lt 0) { $taper = 0 }
        $dotR = $ink * (0.18 + 0.52 * $taper)
        if ($dotR -lt 0.35) { $dotR = 0.35 }

        $alpha = [int](255 * (0.25 + 0.75 * $taper))
        $brush = New-Object System.Drawing.SolidBrush(
            [System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B)
        )
        $g.FillEllipse($brush, ($px - $dotR), ($py - $dotR), ($dotR * 2), ($dotR * 2))
        $brush.Dispose()
    }

    # --- Ring with a gap ---------------------------------------------------
    $ringR = $extent * 0.5
    $stroke = $ink * 0.62
    if ($stroke -lt 1.0) { $stroke = 1.0 }
    $pen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(255, $color.R, $color.G, $color.B),
        $stroke
    )
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $startDeg = -0.62 * 180.0
    $sweepDeg = 1.42 * 180.0
    $g.DrawArc(
        $pen,
        ($cx - $ringR),
        ($cy - $ringR),
        ($ringR * 2),
        ($ringR * 2),
        $startDeg,
        $sweepDeg
    )

    # --- Core --------------------------------------------------------------
    $coreR = $extent * 0.2
    $coreBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, $color.R, $color.G, $color.B)
    )
    $g.FillEllipse($coreBrush, ($cx - $coreR), ($cy - $coreR), ($coreR * 2), ($coreR * 2))
    $coreBrush.Dispose()

    # --- Satellite dot on the ring start -----------------------------------
    $satAngle = $startDeg * [math]::PI / 180.0
    $sx = $cx + [math]::Cos($satAngle) * $ringR
    $sy = $cy + [math]::Sin($satAngle) * $ringR
    $satR = $ink * 0.5
    $satBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, $color.R, $color.G, $color.B)
    )
    $g.FillEllipse($satBrush, ($sx - $satR), ($sy - $satR), ($satR * 2), ($satR * 2))
    $satBrush.Dispose()

    $pen.Dispose()
}

# Full-bleed icon: gradient background + centred white mark.
function New-IconBitmap([int]$size, [double]$markRatio) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $brush = New-BrushGradient($rect)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    $mark = $size * $markRatio
    Draw-OrbitMark $g ($size / 2.0) ($size / 2.0) $mark ([System.Drawing.Color]::White)

    $g.Dispose()
    return $bmp
}

# Transparent adaptive-icon foreground: mark only, inside the 66% safe zone.
function New-AdaptiveForeground([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    # 108dp canvas; the safe zone is the inner 72dp, so the mark sits at ~0.46.
    Draw-OrbitMark $g ($size / 2.0) ($size / 2.0) ($size * 0.46) ([System.Drawing.Color]::White)
    $g.Dispose()
    return $bmp
}

function Save-Resized([System.Drawing.Bitmap]$source, [int]$size, [string]$path) {
    $out = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $g.Dispose()
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
}

Write-Output '== Generating master icon =='
$master = New-IconBitmap 1024 0.60
New-Item -ItemType Directory -Force -Path $brandDir | Out-Null
$master.Save((Join-Path $brandDir 'app_icon_1024.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output '   assets/brand/app_icon_1024.png'

Write-Output '== Android legacy launcher icons =='
$androidSizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($density in $androidSizes.Keys) {
    $size = $androidSizes[$density]
    Save-Resized $master $size (Join-Path $androidRes "mipmap-$density\ic_launcher.png")
    Write-Output "   mipmap-$density/ic_launcher.png ($size px)"
}

Write-Output '== Android adaptive icon foreground =='
$adaptiveSizes = @{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
foreach ($density in $adaptiveSizes.Keys) {
    $size = $adaptiveSizes[$density]
    $fg = New-AdaptiveForeground $size
    $dir = Join-Path $androidRes "mipmap-$density"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $fg.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()
    Write-Output "   mipmap-$density/ic_launcher_foreground.png ($size px)"
}

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
    Save-Resized $master $iosSizes[$name] (Join-Path $iosIconSet $name)
    Write-Output "   $name ($($iosSizes[$name]) px)"
}

$master.Dispose()
Write-Output '== Done =='
