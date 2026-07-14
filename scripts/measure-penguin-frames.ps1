Add-Type -AssemblyName System.Drawing
$path = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\penguin-sprite.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$frameW = [int]($bmp.Width / 10)
$frameH = $bmp.Height
Write-Output "Sheet: $($bmp.Width) x $($bmp.Height), frameW=$frameW frameH=$frameH"

for ($f = 0; $f -lt 10; $f++) {
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
  $cx = [math]::Round(($minX + $maxX) / 2, 1)
  $cy = [math]::Round(($minY + $maxY) / 2, 1)
  Write-Output "Frame $f : bounds x[$minX-$maxX] y[$minY-$maxY]  center=($cx,$cy)  width=$($maxX-$minX) height=$($maxY-$minY)"
}
$bmp.Dispose()
