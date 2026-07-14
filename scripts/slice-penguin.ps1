Add-Type -AssemblyName System.Drawing

$src = "C:\Users\David\Downloads\Pinguin Easter Egg.png"
$outDir = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets"
$outPath = Join-Path $outDir "penguin-sprite.png"

$cols = 5
$rows = 2

$orig = New-Object System.Drawing.Bitmap($src)
$tileW = [int][Math]::Floor($orig.Width / $cols)
$tileH = [int][Math]::Floor($orig.Height / $rows)
Write-Output "Source: $($orig.Width)x$($orig.Height) -> tiles $($tileW)x$($tileH)"

function Remove-BlackBackground {
  param([System.Drawing.Bitmap]$bmp, [int]$tolerance = 22)

  $w = $bmp.Width
  $h = $bmp.Height
  $argb = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($argb)
  $g.DrawImage($bmp, 0, 0, $w, $h)
  $g.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $argb.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

  $stride = $data.Stride
  $visited = New-Object bool[] ($w * $h)
  $queue = New-Object System.Collections.Generic.Queue[int]

  function IsBlackAt($idx) {
    $b = $bytes[$idx]
    $gg = $bytes[$idx + 1]
    $r = $bytes[$idx + 2]
    return ($r -le $tolerance -and $gg -le $tolerance -and $b -le $tolerance)
  }

  for ($x = 0; $x -lt $w; $x++) {
    foreach ($y in 0, ($h - 1)) {
      $p = $y * $w + $x
      if (-not $visited[$p]) { $visited[$p] = $true; $queue.Enqueue($p) }
    }
  }
  for ($y = 0; $y -lt $h; $y++) {
    foreach ($x in 0, ($w - 1)) {
      $p = $y * $w + $x
      if (-not $visited[$p]) { $visited[$p] = $true; $queue.Enqueue($p) }
    }
  }

  while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    $x = $p % $w
    $y = [Math]::Floor($p / $w)
    $idx = $y * $stride + $x * 4
    if (-not (IsBlackAt $idx)) { continue }
    $bytes[$idx + 3] = 0

    foreach ($d in @(@(1,0), @(-1,0), @(0,1), @(0,-1))) {
      $nx = $x + $d[0]
      $ny = $y + $d[1]
      if ($nx -ge 0 -and $nx -lt $w -and $ny -ge 0 -and $ny -lt $h) {
        $np = $ny * $w + $nx
        if (-not $visited[$np]) {
          $visited[$np] = $true
          $queue.Enqueue($np)
        }
      }
    }
  }

  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $argb.UnlockBits($data)
  return $argb
}

$sheetW = $tileW * 10
$sheet = New-Object System.Drawing.Bitmap($sheetW, $tileH)
$gSheet = [System.Drawing.Graphics]::FromImage($sheet)

$i = 0
for ($row = 0; $row -lt $rows; $row++) {
  for ($col = 0; $col -lt $cols; $col++) {
    $rect = New-Object System.Drawing.Rectangle(($col * $tileW), ($row * $tileH), $tileW, $tileH)
    $tile = New-Object System.Drawing.Bitmap($tileW, $tileH)
    $g = [System.Drawing.Graphics]::FromImage($tile)
    $g.DrawImage($orig, (New-Object System.Drawing.Rectangle(0, 0, $tileW, $tileH)), $rect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $transparent = Remove-BlackBackground -bmp $tile -tolerance 22
    $gSheet.DrawImage($transparent, ($i * $tileW), 0, $tileW, $tileH)
    $transparent.Dispose()
    $tile.Dispose()
    $i++
  }
}
$gSheet.Dispose()
$sheet.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Gespeichert: $outPath ($($sheet.Width)x$($sheet.Height))"
$sheet.Dispose()
$orig.Dispose()
