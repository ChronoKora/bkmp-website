# BKMP Asset Generator

Ein lokales, sicheres, vom eigentlichen Spiel unabhaengiges Kommandozeilen-Tool,
um spaeter hochwertige Fantasy-Game-UI-Assets (Icons, Buttons, Panels, Rahmen,
Effekte, Hintergruende) ueber die OpenAI Image API zu erzeugen.

**Dieses Tool veraendert niemals bestehenden Spiel-Code** (kein HTML/CSS/JS
des Spiels, keine Datenbank, kein Supabase). Es kennt nur seine eigenen
Dateien unter `tools/asset-generator/` und `assets/generated/` sowie die drei
Root-Dateien `asset-manifest.json`, `asset-preview.html` und `.env.example`.

## Zweck

- Generiert einzelne PNG-Assets per Preset + Prompt ueber die OpenAI Images
  API (`gpt-image-1.5` standardmaessig, ueber Umgebungsvariable austauschbar).
- Verwaltet alle erzeugten Assets in `asset-manifest.json` (eine JSON-Datei,
  kein Server, keine Datenbank).
- Baut daraus automatisch eine eigenstaendige, offline nutzbare Vorschauseite
  `asset-preview.html` sowie eine CSS-Datei
  `assets/generated/generated-assets.css` (wird vom bestehenden Spiel aktuell
  **nicht** automatisch eingebunden - das ist eine bewusste, spaetere
  Entscheidung).

## Installation

Voraussetzung: Python 3.9+ (getestet mit 3.14). Aus dem Projekt-Root:

```powershell
py -m pip install -r tools/asset-generator/requirements.txt
```

Git Bash / macOS / Linux:

```bash
python3 -m pip install -r tools/asset-generator/requirements.txt
```

**Wichtig:** `--doctor`, `--list-presets`, `--dry-run`, `--validate`,
`--rebuild-preview` und alle Unit-Tests funktionieren auch **ohne**
installierte `openai`/`Pillow`-Pakete - diese werden ausschliesslich beim
echten `--generate` lazy importiert.

## Einrichtung des API-Keys

1. Kopiere `.env.example` (Projekt-Root) zu `.env.local` (ebenfalls
   Projekt-Root, **nicht** in `tools/asset-generator/`).
2. Trage in `.env.local` deinen echten `OPENAI_API_KEY` ein.
3. `.env.local` wird durch `.gitignore` von Git ignoriert und daher **nie**
   committet.

Alternativ kannst du die Umgebungsvariablen auch direkt in der Shell setzen
(z. B. `$env:OPENAI_API_KEY = "sk-..."` in PowerShell) - das hat Vorrang vor
`.env.local`.

### Sicherheitshinweise

- Der API-Key wird ausschliesslich aus der Umgebung oder `.env.local`
  gelesen und **niemals** ausgegeben - weder im Terminal noch im Manifest,
  im CSS, im HTML oder in Logdateien. `--doctor` zeigt nur "vorhanden:
  ja/nein".
- **Echte Bildgenerierungen verursachen echte OpenAI-API-Kosten.** Eine
  Anfrage wird ausschliesslich gesendet, wenn **sowohl** `--generate` **als
  auch** `--confirm-api-call` gesetzt sind. Jeder andere Aufruf (inkl.
  `--dry-run`) sendet garantiert keine Anfrage.
- Bestehende PNG-Dateien und Manifest-Eintraege werden ohne `--force` nie
  ueberschrieben.
- Modell `gpt-image-2` unterstuetzt in dieser Konfiguration keinen
  transparenten Hintergrund - eine Kombination aus `OPENAI_IMAGE_MODEL=
  gpt-image-2` und `background=transparent` wird abgelehnt, **bevor** eine
  Anfrage gesendet wird.
- `--prompt-file` darf nicht auf eine lokale Secret-/Env-Datei zeigen (jeder
  Dateiname, der auf `.env` oder `.env.*` passt, z. B. `.env.local` oder
  `.env.example`, wird abgelehnt) - sonst koennte deren Inhalt (inkl. echtem
  API-Key) als "Prompt" ausgegeben und sogar an die API gesendet werden.
- `--target-size` ist auf maximal 4096px pro Achse begrenzt (Schutz gegen
  versehentliche riesige Bildallokationen).
- Das Manifest wird bei einer echten Generierung unmittelbar vor dem
  Schreiben nochmal frisch von der Platte geladen (nicht aus einer evtl.
  laengst veralteten Momentaufnahme) - das verkleinert das Risiko, beim
  gleichzeitigen Ausfuehren mehrerer Auftraege einen bereits gespeicherten
  Eintrag versehentlich zu verlieren. Fuer echte Parallelsicherheit gibt es
  aber keine Datei-Sperre (OS-Locking) - fuehre echte `--generate`-Auftraege
  im Zweifel nacheinander statt gleichzeitig in mehreren Terminals aus.

## Umgebungsvariablen

| Variable | Standardwert | Bedeutung |
|---|---|---|
| `OPENAI_API_KEY` | (keiner) | Dein echter API-Key. Nur aus Umgebung/`.env.local`. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1.5` | Modell fuer die Images API. |
| `OPENAI_IMAGE_QUALITY` | `medium` | Anzeige-/Fallback-Qualitaet (Presets koennen abweichen). |

## Befehle

Alle Befehle werden aus dem Projekt-Root heraus aufgerufen.

### `--doctor` - Umgebung pruefen

```powershell
py tools/asset-generator/generate_asset.py --doctor
```

Prueft Python-Version, Projektpfad, Schreibrechte, Verzeichnisstruktur,
installierte Abhaengigkeiten, ob ein API-Key vorhanden ist (nur ja/nein),
die aktuelle Modellkonfiguration sowie ob Presets und Manifest gueltig sind.

### `--list-presets` - Presets anzeigen

```powershell
py tools/asset-generator/generate_asset.py --list-presets
```

### `--dry-run` - Plan ohne API-Kosten anzeigen

Zeigt exakt, was passieren wuerde (finale ID, Kategorie, Ausgabepfad,
Preset, Modell, Groesse, Qualitaet, Hintergrund, final zusammengesetzter
Prompt, geplante Manifestdaten) - **ohne** eine API-Anfrage zu senden und
**ohne** eine Datei zu schreiben.

Windows PowerShell:

```powershell
py tools/asset-generator/generate_asset.py `
  --id test-upgrade-hammer `
  --preset fantasy-icon `
  --category icons `
  --prompt-file tools/asset-generator/prompts/test-upgrade-hammer.txt `
  --target-size 256x256 `
  --dry-run
```

PowerShell (eine Zeile):

```powershell
py tools/asset-generator/generate_asset.py --id test-upgrade-hammer --preset fantasy-icon --category icons --prompt-file tools/asset-generator/prompts/test-upgrade-hammer.txt --target-size 256x256 --dry-run
```

Git Bash:

```bash
py tools/asset-generator/generate_asset.py \
  --id test-upgrade-hammer \
  --preset fantasy-icon \
  --category icons \
  --prompt-file tools/asset-generator/prompts/test-upgrade-hammer.txt \
  --target-size 256x256 \
  --dry-run
```

### Echte Generierung (verursacht API-Kosten!)

Erst NACH bewusster Pruefung des Dry-Runs - erfordert zwingend beide Flags:

```powershell
py tools/asset-generator/generate_asset.py `
  --id test-upgrade-hammer `
  --preset fantasy-icon `
  --category icons `
  --prompt-file tools/asset-generator/prompts/test-upgrade-hammer.txt `
  --target-size 256x256 `
  --generate `
  --confirm-api-call
```

Fehlt `--generate` oder `--confirm-api-call`, wird garantiert keine Anfrage
gesendet - stattdessen eine klare Fehlermeldung mit Exit-Code ungleich 0.

### `--rebuild-preview` - Vorschau neu bauen

```powershell
py tools/asset-generator/generate_asset.py --rebuild-preview
```

Baut `assets/generated/generated-assets.css` und `asset-preview.html`
ausschliesslich aus `asset-manifest.json` neu auf. Danach `asset-preview.html`
einfach im Browser oeffnen (funktioniert komplett offline, kein Server
noetig).

### `--validate` - Alles pruefen

```powershell
py tools/asset-generator/generate_asset.py --validate
```

Prueft Presets, Manifest-Struktur, referenzierte Dateien/Pfade und (falls
Pillow installiert ist) echte Bildgroessen/Pruefsummen gegen die
Manifest-Angaben.

### Ueberschreibschutz

Ohne `--force` werden bestehende PNG-Dateien und Manifest-Eintraege
derselben ID **nie** ueberschrieben - der Befehl bricht stattdessen mit einer
klaren Fehlermeldung ab, bevor irgendeine API-Anfrage gesendet wird. Mit
`--force` wird gezielt genau dieses eine Asset ersetzt.

## Manifest (`asset-manifest.json`)

Liegt im Projekt-Root, JSON mit `version`, `updated_at` und einer Liste
`assets`. Jeder Eintrag enthaelt u. a. `id`, `category`, `file` (relativer
Pfad unter `assets/generated/`), `preset`, `model`, `api_size`,
`final_width`/`final_height`, `quality`, `background`, `fit`, `sha256`,
`created_at`, `has_alpha`. Wird ausschliesslich vom Tool selbst geschrieben
(atomar: erst eine temporaere Datei, dann ein atomarer Umbenennungsvorgang -
nie eine halb geschriebene Datei).

## Ordnerstruktur

```
tools/asset-generator/
  generate_asset.py     - die CLI selbst
  presets.json           - die 6 Fantasy-Presets
  requirements.txt        - openai, python-dotenv, Pillow
  README.md               - diese Datei
  prompts/                - eigene Prompt-Textdateien (UTF-8, *.txt)
  tests/                   - unittest-Suite (keine Netzwerkverbindung)

assets/generated/
  icons/ buttons/ panels/ frames/ effects/ backgrounds/  - erzeugte PNGs
  generated-assets.css    - automatisch aus dem Manifest gebaut

asset-manifest.json       - Projekt-Root, Quelle der Wahrheit
asset-preview.html        - Projekt-Root, statische Vorschauseite
.env.example               - Projekt-Root, Vorlage ohne echten Key
```

## Tests ausfuehren

```powershell
py -m unittest discover -s tools/asset-generator/tests -v
```

Alle Tests laufen vollstaendig lokal in temporaeren Verzeichnissen, senden
keine Netzwerkanfragen und veraendern nie echte Projektassets.
