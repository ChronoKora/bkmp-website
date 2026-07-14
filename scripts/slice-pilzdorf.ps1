Add-Type -AssemblyName System.Drawing

$src = "C:\Users\David\Desktop\Dorf Skin\Pilzdorf.png"
$outDir = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\village"

# Per Vollscan (diag-fullscan.ps1, >85% schwarze Pixel je Spalte/Zeile)
# exakt vermessen: das Raster ist 2 SPALTEN x 3 ZEILEN (nicht 3x2!).
# Trennlinien: Spalten-Luecke bei x=762-774, Zeilen-Luecken bei
# y=337-350 und y=672-684, plus Aussenrand rundum.
$colX = @(13, 775)
$rowY = @(14, 351, 685)
$frameW = 749
$frameH = 321

$bmp = [System.Drawing.Bitmap]::FromFile($src)
$sheetW = $frameW * 6
$sheet = New-Object System.Drawing.Bitmap($sheetW, $frameH)
$gSheet = [System.Drawing.Graphics]::FromImage($sheet)
$i = 0
foreach ($y in $rowY) {
  foreach ($x in $colX) {
    $srcRect = New-Object System.Drawing.Rectangle $x, $y, $frameW, $frameH
    $destRect = New-Object System.Drawing.Rectangle ($i * $frameW), 0, $frameW, $frameH
    $gSheet.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $i++
  }
}
$gSheet.Dispose()

$outPath = Join-Path $outDir "pilzdorf.png"
$sheet.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Gespeichert: $outPath ($($sheet.Width)x$($sheet.Height))"

$sheet.Dispose()
$bmp.Dispose()
