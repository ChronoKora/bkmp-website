# Bkmp - Redesign Phase 1 (17.07.): Wrapper um optimize-images.mjs.
#
# Warum ein .mjs-Script dahinter statt reinem PowerShell (wie bei den
# anderen slice-*.ps1/fix-*.ps1 in diesem Ordner): PowerShells eingebautes
# System.Drawing (siehe fix-kaledoss-background.ps1) kann zwar verkleinern,
# aber kein WebP schreiben - das braucht eine echte Bildbibliothek. "sharp"
# (Node.js) macht das zuverlaessig und wird NICHT Teil der Website/des
# Deploys - nur ein einmaliges Werkzeug hier auf dem Rechner, mit dem neue
# Kunst vor dem Commit verkleinert wird. Ergebnis sind fertige, statische
# WebP/PNG-Dateien, genau wie bei den anderen Skripten hier.
#
# Einmalig einrichten (nur beim ALLERERSTEN Mal noetig):
#   npm install sharp --no-save --prefix "$env:TEMP\bkmp-image-tools"
#
# Aufruf (Beispiel: alle Drachen-Zucht-Sprites, angezeigt bei maximal 160
# CSS-Pixeln -> 480px deckt auch 3x-Retina-Displays ab):
#   .\scripts\optimize-images.ps1 -Folder "assets\dragons\breeding" -MaxDimension 480
#
# Erzeugt pro Bild.png zusaetzlich Bild-web.webp und Bild-web.png daneben,
# das Original bleibt unangetastet liegen. Welche Dateien tatsaechlich im
# Spiel benutzt werden, entscheidet die HTML-/JS-Seite (<picture>-Tag) -
# dieses Skript liefert nur die kleineren Varianten.

param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [int]$MaxDimension = 480,
  [int]$WebpQuality = 82
)

$toolsNodeModules = Join-Path $env:TEMP "bkmp-image-tools\node_modules"
if (-not (Test-Path $toolsNodeModules)) {
  Write-Host "sharp ist noch nicht installiert. Einmalig ausfuehren:"
  Write-Host "  npm install sharp --no-save --prefix `"$env:TEMP\bkmp-image-tools`""
  exit 1
}

$env:NODE_PATH = $toolsNodeModules
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir "optimize-images.mjs") $Folder $MaxDimension $WebpQuality
