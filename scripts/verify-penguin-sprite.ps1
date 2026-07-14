Add-Type -AssemblyName System.Drawing
$path = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\penguin-sprite.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$frameCount = 4
$frameW = [int]($bmp.Width / $frameCount)
$frameH = $bmp.Height
Write-Output "Sheet: $($bmp.Width) x $($bmp.Height), frameW=$frameW frameH=$frameH"

for ($f = 0; $f -lt $frameCount; $f++) {
  $x0 = $f * $frameW
  $minX = $frameW; $maxX = -1; $minY = $frameH; $maxY = -1
  for ($y = 0; $y -lt $frameH; $y += 2) {
    for ($x = 0; $x -lt $frameW; $x += 2) {
      $px = $bmp.GetPixel($x0 + $x, $y)
      if ($px.A -gt 20) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cy = [math]::Round(($minY + $maxY) / 2, 1)
  Write-Output "Frame $f : bounds x[$minX-$maxX] y[$minY-$maxY]  centerY=$cy"
}
$bmp.Dispose()
