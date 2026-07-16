# Bkmp - Spieler-Meldung 17.07.: "Kaledoss ist der einzige Drache, der nicht
# ordentlich ausgeschnitten war, sein Hintergrund ist noch weiss statt
# transparent." Betrifft teen/adult (egg/baby sind bereits transparent, siehe
# Diagnose). Gleiches Flood-Fill-Verfahren wie slice-penguin.ps1
# (Remove-BlackBackground), hier fuer WEISS statt SCHWARZ: startet an allen
# vier Bildraendern und faerbt nur zusammenhaengende (mit dem Rand verbundene)
# nahezu-weisse Pixel transparent - ein weisser Fleck MITTEN im Drachen (z.B.
# ein heller Bauch) bleibt dadurch unangetastet, nur der echte Hintergrund
# verschwindet.
Add-Type -AssemblyName System.Drawing

function Remove-WhiteBackground {
  param([string]$path, [int]$tolerance = 12)

  $orig = New-Object System.Drawing.Bitmap($path)
  $w = $orig.Width
  $h = $orig.Height
  $argb = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($argb)
  $g.DrawImage($orig, 0, 0, $w, $h)
  $g.Dispose()
  $orig.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $argb.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

  $threshold = 255 - $tolerance
  $visited = New-Object bool[] ($w * $h)
  $queue = New-Object System.Collections.Generic.Queue[int]

  function IsWhiteAt($idx) {
    if ($bytes[$idx + 3] -eq 0) { return $false }
    $b = $bytes[$idx]; $gg = $bytes[$idx + 1]; $r = $bytes[$idx + 2]
    return ($r -ge $threshold -and $gg -ge $threshold -and $b -ge $threshold)
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

  $removed = 0
  while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    $x = $p % $w
    $y = [Math]::Floor($p / $w)
    $idx = $y * $stride + $x * 4
    if (-not (IsWhiteAt $idx)) { continue }
    $bytes[$idx + 3] = 0
    $removed++
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
  $argb.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $argb.Dispose()
  Write-Output "$path : $removed Pixel transparent gemacht"
}

$stages = @('egg','baby','teen','adult')
foreach ($stage in $stages) {
  $path = "C:\Users\David\Documents\Codex\2026-07-03\s\work\bkmp-website\assets\dragons\breeding\$stage\kaledoss.png"
  Remove-WhiteBackground -path $path
}
