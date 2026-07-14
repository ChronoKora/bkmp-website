Add-Type -AssemblyName System.Drawing
$srcPath = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\penguin-sprite-original-10frame.png.bak"
$outPath = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\penguin-sprite.png"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$frameW = [int]($src.Width / 10)
$frameH = $src.Height

# Nur die 4 PERFEKT deckungsgleichen Frames (Index 6-9 im urspruenglichen
# 10er-Sheet, 0-basiert) - Frame 5 lag beim ersten Versuch noch ca. 8-9px
# hoeher als 6-9 (kleiner Rest-Sprung, Spieler-Feedback "wechselt Position
# minimal"), Frame 6-9 haben exakt dieselben y-Grenzen (68-346, nur Frame 7
# mit 66 statt 68 - 2px, nicht wahrnehmbar). Baut aus dem ORIGINAL-Backup,
# nicht aus dem bereits einmal reduzierten 5-Frame-Zwischenstand.
$keepFrames = @(6, 7, 8, 9)

$outBmp = New-Object System.Drawing.Bitmap ($frameW * $keepFrames.Count), $frameH
$g = [System.Drawing.Graphics]::FromImage($outBmp)
$g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy

for ($i = 0; $i -lt $keepFrames.Count; $i++) {
  $srcX = $keepFrames[$i] * $frameW
  $srcRect = New-Object System.Drawing.Rectangle $srcX, 0, $frameW, $frameH
  $destRect = New-Object System.Drawing.Rectangle ($i * $frameW), 0, $frameW, $frameH
  $g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
}
$g.Dispose()
$src.Dispose()

$outBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$outBmp.Dispose()
Write-Output "Neues Sprite gespeichert: $($keepFrames.Count) Frames, $($frameW * $keepFrames.Count) x $frameH"
