#!/usr/bin/env python3
"""BKMP Fantasy Asset Generator - lokales, sicheres, projektunabhaengiges CLI-Tool.

Erzeugt spaeter hochwertige Fantasy-Game-UI-Assets (Icons, Buttons, Panels,
Rahmen, Effekte, Hintergruende) ueber die OpenAI Image API und verwaltet sie
in einem Manifest (asset-manifest.json) + einer statischen Vorschauseite
(asset-preview.html).

Wichtige Sicherheitsregeln (siehe README.md fuer Details):
- openai/Pillow werden NUR dort importiert, wo sie wirklich gebraucht werden
  (--generate). --doctor/--dry-run/--validate/--rebuild-preview/--list-presets
  und alle Unit-Tests funktionieren komplett ohne installierte Pakete.
- Der API-Key wird NIE ausgegeben, geloggt oder ins Manifest/CSS/HTML/Terminal
  geschrieben - ausschliesslich "vorhanden: ja/nein".
- Eine echte (kostenpflichtige) API-Anfrage erfolgt ausschliesslich, wenn
  SOWOHL --generate ALS AUCH --confirm-api-call gesetzt sind.
- Dieses Skript fasst niemals bestehende Spiel-Dateien (HTML/CSS/JS/SQL/DB)
  an - es kennt nur seine eigenen Pfade unter tools/asset-generator/ und
  assets/generated/ sowie die drei Root-Dateien asset-manifest.json,
  asset-preview.html und .env.example.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------
# Konstanten / Pfade (alle relativ zu diesem Skript, kein hartcodiertes OS-
# spezifisches Trennzeichen - komplett ueber pathlib aufgeloest)
# --------------------------------------------------------------------------

TOOL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TOOL_DIR.parent.parent
PROMPTS_DIR = TOOL_DIR / "prompts"
TESTS_DIR = TOOL_DIR / "tests"
PRESETS_PATH = TOOL_DIR / "presets.json"

MANIFEST_PATH = PROJECT_ROOT / "asset-manifest.json"
PREVIEW_HTML_PATH = PROJECT_ROOT / "asset-preview.html"
ENV_LOCAL_PATH = PROJECT_ROOT / ".env.local"

GENERATED_ASSETS_DIR = PROJECT_ROOT / "assets" / "generated"
GENERATED_CSS_PATH = GENERATED_ASSETS_DIR / "generated-assets.css"
GENERATED_PREFIX = "assets/generated/"

ALLOWED_CATEGORIES = ("icons", "buttons", "panels", "frames", "effects", "backgrounds")
ALLOWED_SIZES = ("1024x1024", "1024x1536", "1536x1024")
ALLOWED_QUALITIES = ("low", "medium", "high", "auto")
ALLOWED_BACKGROUNDS = ("transparent", "opaque", "auto")
ALLOWED_FITS = ("contain", "cover", "stretch")

DEFAULT_MODEL = "gpt-image-1.5"
DEFAULT_QUALITY = "medium"
UNSUPPORTED_TRANSPARENT_MODEL = "gpt-image-2"
MAX_TARGET_DIMENSION = 4096

ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.png$")
TARGET_SIZE_PATTERN = re.compile(r"^(\d{1,5})x(\d{1,5})$")
# --prompt-file darf niemals auf eine lokale Secret-/Env-Datei zeigen (z.B. .env.local) -
# sonst wuerde deren Inhalt inkl. echtem API-Key als "Prompt" ausgegeben und sogar an
# die OpenAI-API gesendet werden koennen. Siehe README-Sicherheitshinweise.
BLOCKED_PROMPT_FILE_PATTERN = re.compile(r"^\.env(\..*)?$", re.IGNORECASE)
# Manifest-Dateipfade duerfen ausschliesslich aus Zeichen bestehen, die unsere eigene
# validate_filename()/validate_category() ohnehin je erzeugen koennten - verhindert, dass
# ein von Hand manipuliertes Manifest per Anfuehrungszeichen aus einem CSS url(...) ausbricht.
SAFE_MANIFEST_FILE_PATTERN = re.compile(r"^[A-Za-z0-9_./-]+$")

REQUIRED_PRESET_FIELDS = (
    "description",
    "default_category",
    "default_size",
    "default_quality",
    "default_background",
    "prompt_prefix",
    "prompt_suffix",
)


class AssetGeneratorError(Exception):
    """Erwartete, dem Nutzer verstaendlich erklaerbare Fehler dieses Tools."""


# --------------------------------------------------------------------------
# Kleine, reine Hilfsfunktionen (pfad-/stringbasiert, keine externen Pakete)
# --------------------------------------------------------------------------


def validate_asset_id(raw_id: str) -> str:
    if not raw_id or not isinstance(raw_id, str):
        raise AssetGeneratorError("--id darf nicht leer sein.")
    if "/" in raw_id or "\\" in raw_id:
        raise AssetGeneratorError(f"--id '{raw_id}' darf keine Pfadseparatoren enthalten.")
    if ".." in raw_id:
        raise AssetGeneratorError(f"--id '{raw_id}' darf '..' nicht enthalten.")
    if not ID_PATTERN.match(raw_id):
        raise AssetGeneratorError(
            f"--id '{raw_id}' ist kein gueltiges kebab-case (nur a-z, 0-9, Bindestriche, "
            "z.B. 'upgrade-hammer')."
        )
    return raw_id


def validate_category(raw_category: str) -> str:
    if raw_category not in ALLOWED_CATEGORIES:
        raise AssetGeneratorError(
            f"Ungueltige --category '{raw_category}'. Erlaubt: {', '.join(ALLOWED_CATEGORIES)}"
        )
    return raw_category


def validate_filename(raw_name: str) -> str:
    if not raw_name:
        raise AssetGeneratorError("--filename darf nicht leer sein.")
    if "/" in raw_name or "\\" in raw_name:
        raise AssetGeneratorError(f"--filename '{raw_name}' darf keine Verzeichnisbestandteile enthalten.")
    if ".." in raw_name:
        raise AssetGeneratorError(f"--filename '{raw_name}' darf '..' nicht enthalten.")
    if Path(raw_name).name != raw_name:
        raise AssetGeneratorError(f"--filename '{raw_name}' ist kein einfacher Dateiname.")
    if not FILENAME_PATTERN.match(raw_name):
        raise AssetGeneratorError(
            f"--filename '{raw_name}' ist ungueltig. Erlaubt: Buchstaben, Zahlen, Punkt, "
            "Unterstrich, Bindestrich - muss auf '.png' enden."
        )
    return raw_name


def validate_size(raw_size: str) -> str:
    if raw_size not in ALLOWED_SIZES:
        raise AssetGeneratorError(f"Ungueltige --size '{raw_size}'. Erlaubt: {', '.join(ALLOWED_SIZES)}")
    return raw_size


def validate_quality(raw_quality: str) -> str:
    if raw_quality not in ALLOWED_QUALITIES:
        raise AssetGeneratorError(
            f"Ungueltige --quality '{raw_quality}'. Erlaubt: {', '.join(ALLOWED_QUALITIES)}"
        )
    return raw_quality


def validate_background(raw_background: str) -> str:
    if raw_background not in ALLOWED_BACKGROUNDS:
        raise AssetGeneratorError(
            f"Ungueltiger --background '{raw_background}'. Erlaubt: {', '.join(ALLOWED_BACKGROUNDS)}"
        )
    return raw_background


def validate_fit(raw_fit: str) -> str:
    if raw_fit not in ALLOWED_FITS:
        raise AssetGeneratorError(f"Ungueltiger --fit '{raw_fit}'. Erlaubt: {', '.join(ALLOWED_FITS)}")
    return raw_fit


def parse_target_size(raw: str) -> tuple[int, int]:
    match = TARGET_SIZE_PATTERN.match(raw.strip())
    if not match:
        raise AssetGeneratorError(f"Ungueltiges --target-size Format: '{raw}'. Erwartet z.B. 256x256.")
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        raise AssetGeneratorError("--target-size Werte muessen groesser als 0 sein.")
    if width > MAX_TARGET_DIMENSION or height > MAX_TARGET_DIMENSION:
        raise AssetGeneratorError(
            f"--target-size Werte duerfen {MAX_TARGET_DIMENSION}px nicht ueberschreiten "
            f"(erhalten: {width}x{height})."
        )
    return (width, height)


def safe_css_id(asset_id: str) -> str:
    """Sanitisiert eine Asset-ID defensiv fuer den Einsatz als CSS-Bezeichner.

    validate_asset_id() erzwingt bereits kebab-case, diese Funktion ist ein
    zusaetzliches, unabhaengiges Sicherheitsnetz falls sie je mit weniger
    strikt geprueften Daten aufgerufen wird.
    """
    cleaned = re.sub(r"[^a-z0-9-]", "-", (asset_id or "").lower())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "asset"


def is_importable(module_name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def resolve_model() -> str:
    value = os.environ.get("OPENAI_IMAGE_MODEL", "").strip()
    return value or DEFAULT_MODEL


def resolve_quality_default() -> str:
    value = os.environ.get("OPENAI_IMAGE_QUALITY", "").strip()
    return value or DEFAULT_QUALITY


def resolve_api_key() -> str | None:
    """Liest den API-Key ausschliesslich aus der Umgebung oder .env.local.

    Gibt NIE den Wert selbst irgendwo aus - nur dieser Rueckgabewert (oder
    ein daraus abgeleitetes ja/nein) darf im Programm weiterverwendet werden.
    """
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    if ENV_LOCAL_PATH.is_file():
        try:
            from dotenv import dotenv_values  # lazy: nur falls .env.local existiert
        except ImportError:
            return None
        try:
            values = dotenv_values(str(ENV_LOCAL_PATH))
        except Exception:
            return None
        key = (values.get("OPENAI_API_KEY") or "").strip()
        if key:
            return key
    return None


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def to_relative_posix(path: Path) -> str:
    try:
        rel = path.resolve().relative_to(PROJECT_ROOT.resolve())
        return rel.as_posix()
    except ValueError:
        return path.resolve().as_posix()


def describe_path_for_report(path: Path) -> str:
    return to_relative_posix(path)


def check_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        return False
    probe = path / f".doctor-write-test-{os.getpid()}.tmp"
    try:
        probe.write_text("ok", encoding="utf-8")
        return True
    except Exception:
        return False
    finally:
        try:
            probe.unlink(missing_ok=True)
        except Exception:
            pass


def atomic_write_text(dest_path: Path, text: str, encoding: str = "utf-8") -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f"{dest_path.stem}-", suffix=".tmp", dir=str(dest_path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(str(tmp_path), str(dest_path))
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def atomic_write_bytes(dest_path: Path, data: bytes) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f"{dest_path.stem}-", suffix=".tmp", dir=str(dest_path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(str(tmp_path), str(dest_path))
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def resolve_prompt_file(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_file():
        resolved = candidate.resolve()
    else:
        alt = PROJECT_ROOT / raw_path
        if alt.is_file():
            resolved = alt.resolve()
        else:
            raise AssetGeneratorError(f"Prompt-Datei nicht gefunden: {raw_path}")

    if BLOCKED_PROMPT_FILE_PATTERN.match(resolved.name):
        raise AssetGeneratorError(
            f"--prompt-file '{raw_path}' zeigt auf eine lokale Secret-/Env-Datei "
            f"('{resolved.name}') - das ist aus Sicherheitsgruenden nicht erlaubt, "
            "auch nicht bei --dry-run (Inhalt wuerde sonst als Prompt ausgegeben "
            "und potenziell an die API gesendet)."
        )
    return resolved


# --------------------------------------------------------------------------
# Presets
# --------------------------------------------------------------------------


def load_presets() -> dict:
    if not PRESETS_PATH.is_file():
        raise AssetGeneratorError(f"presets.json nicht gefunden: {PRESETS_PATH}")
    try:
        with PRESETS_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        raise AssetGeneratorError(f"presets.json ist kein gueltiges JSON: {exc}") from exc
    if not isinstance(data, dict) or not data:
        raise AssetGeneratorError("presets.json muss ein nicht-leeres JSON-Objekt sein.")
    return data


def validate_presets(presets: dict) -> list[str]:
    issues: list[str] = []
    if not isinstance(presets, dict) or not presets:
        return ["presets.json muss ein nicht-leeres JSON-Objekt sein."]
    for name, preset in presets.items():
        if not isinstance(preset, dict):
            issues.append(f"Preset '{name}': muss ein Objekt sein.")
            continue
        for field in REQUIRED_PRESET_FIELDS:
            if field not in preset:
                issues.append(f"Preset '{name}': fehlendes Feld '{field}'.")
        if preset.get("default_category") not in ALLOWED_CATEGORIES:
            issues.append(f"Preset '{name}': ungueltige default_category '{preset.get('default_category')}'.")
        if preset.get("default_size") not in ALLOWED_SIZES:
            issues.append(f"Preset '{name}': ungueltige default_size '{preset.get('default_size')}'.")
        if preset.get("default_quality") not in ALLOWED_QUALITIES:
            issues.append(f"Preset '{name}': ungueltige default_quality '{preset.get('default_quality')}'.")
        if preset.get("default_background") not in ALLOWED_BACKGROUNDS:
            issues.append(
                f"Preset '{name}': ungueltiger default_background '{preset.get('default_background')}'."
            )
    return issues


def get_preset(name: str, presets: dict) -> dict:
    if name not in presets:
        available = ", ".join(sorted(presets.keys()))
        raise AssetGeneratorError(f"Unbekanntes --preset '{name}'. Verfuegbar: {available}")
    return presets[name]


def compose_prompt(preset: dict, user_prompt: str) -> str:
    prefix = str(preset.get("prompt_prefix", "")).strip()
    suffix = str(preset.get("prompt_suffix", "")).strip()
    parts = [part for part in (prefix, user_prompt.strip(), suffix) if part]
    return "\n\n".join(parts)


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------


def default_manifest() -> dict:
    return {"version": 1, "updated_at": None, "assets": []}


def load_manifest() -> dict:
    if not MANIFEST_PATH.is_file():
        raise AssetGeneratorError(
            f"Manifest nicht gefunden: {MANIFEST_PATH}. Erwartet z.B. "
            '{"version": 1, "updated_at": null, "assets": []}'
        )
    try:
        with MANIFEST_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        raise AssetGeneratorError(f"Manifest ist kein gueltiges JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise AssetGeneratorError("Manifest muss ein JSON-Objekt sein.")
    data.setdefault("version", 1)
    data.setdefault("updated_at", None)
    data.setdefault("assets", [])
    return data


def validate_manifest(manifest: dict) -> list[str]:
    issues: list[str] = []
    if not isinstance(manifest, dict):
        return ["Manifest muss ein JSON-Objekt sein."]
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        issues.append("Manifest: 'assets' muss eine Liste sein.")
        return issues

    seen_ids: set[str] = set()
    generated_root = GENERATED_ASSETS_DIR.resolve()
    for index, entry in enumerate(assets):
        if not isinstance(entry, dict):
            issues.append(f"Manifest-Eintrag #{index}: muss ein Objekt sein.")
            continue

        asset_id = entry.get("id")
        label = asset_id if asset_id else f"#{index}"
        if not asset_id or not isinstance(asset_id, str) or not ID_PATTERN.match(asset_id):
            issues.append(f"Manifest-Eintrag {label}: ungueltige oder fehlende 'id'.")
        elif asset_id in seen_ids:
            issues.append(f"Manifest: doppelte id '{asset_id}'.")
        else:
            seen_ids.add(asset_id)

        if entry.get("category") not in ALLOWED_CATEGORIES:
            issues.append(f"Manifest-Eintrag '{label}': ungueltige category '{entry.get('category')}'.")

        file_rel = entry.get("file")
        if not file_rel or not isinstance(file_rel, str) or "\\" in file_rel or ".." in file_rel:
            issues.append(f"Manifest-Eintrag '{label}': verdaechtiger Dateipfad '{file_rel}'.")
            continue
        if not SAFE_MANIFEST_FILE_PATTERN.match(file_rel):
            issues.append(
                f"Manifest-Eintrag '{label}': Dateipfad enthaelt unzulaessige Zeichen: '{file_rel}'."
            )
            continue

        abs_path = (PROJECT_ROOT / file_rel).resolve()
        try:
            inside = abs_path.is_relative_to(generated_root)
        except Exception:
            inside = False
        if not inside:
            issues.append(f"Manifest-Eintrag '{label}': Pfad liegt ausserhalb von assets/generated: {file_rel}")
        elif not abs_path.exists():
            issues.append(f"Manifest-Eintrag '{label}': Datei fehlt auf der Festplatte: {file_rel}")

    return issues


def find_asset_by_id(manifest: dict, asset_id: str) -> dict | None:
    for entry in manifest.get("assets", []):
        if isinstance(entry, dict) and entry.get("id") == asset_id:
            return entry
    return None


def write_manifest_atomic(manifest: dict) -> None:
    text = json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=False) + "\n"
    atomic_write_text(MANIFEST_PATH, text)


def upsert_manifest_entry(manifest: dict, entry: dict, force: bool) -> dict:
    assets = manifest.setdefault("assets", [])
    existing_index = next(
        (i for i, a in enumerate(assets) if isinstance(a, dict) and a.get("id") == entry["id"]), None
    )
    if existing_index is not None:
        if not force:
            raise AssetGeneratorError(
                f"Asset '{entry['id']}' existiert bereits im Manifest. Nutze --force zum Ueberschreiben."
            )
        assets[existing_index] = entry
    else:
        assets.append(entry)
    manifest["version"] = manifest.get("version", 1)
    manifest["updated_at"] = iso_utc_now()
    return manifest


def deep_validate_asset_file(entry: dict) -> list[str]:
    """Prueft (falls Pillow installiert ist) echte Bildgroesse/Alpha/sha256
    gegen die Manifest-Angaben. Wird nur fuer Eintraege aufgerufen, deren
    Basis-Pfadpruefung (validate_manifest) bereits erfolgreich war."""
    issues: list[str] = []
    asset_id = entry.get("id", "?")
    file_rel = entry.get("file")
    abs_path = (PROJECT_ROOT / file_rel).resolve()

    if not is_importable("PIL"):
        issues.append(f"Asset '{asset_id}': Pillow nicht installiert - Bildpruefung uebersprungen.")
        return issues

    from PIL import Image  # lazy

    try:
        with Image.open(abs_path) as img:
            img_w, img_h = img.size
    except Exception as exc:
        issues.append(f"Asset '{asset_id}': Bilddatei konnte nicht geoeffnet werden ({exc}).")
        return issues

    if entry.get("final_width") != img_w or entry.get("final_height") != img_h:
        issues.append(
            f"Asset '{asset_id}': Manifest-Groesse ({entry.get('final_width')}x{entry.get('final_height')}) "
            f"weicht von echter Bildgroesse ({img_w}x{img_h}) ab."
        )

    expected_sha = entry.get("sha256")
    if expected_sha:
        try:
            actual_sha = sha256_of_file(abs_path)
            if actual_sha != expected_sha:
                issues.append(f"Asset '{asset_id}': sha256 stimmt nicht mit der Datei ueberein.")
        except Exception as exc:
            issues.append(f"Asset '{asset_id}': sha256 konnte nicht berechnet werden ({exc}).")

    return issues


# --------------------------------------------------------------------------
# CSS-Generierung (assets/generated/generated-assets.css)
# --------------------------------------------------------------------------


def css_relative_path(file_field: str) -> str:
    if file_field.startswith(GENERATED_PREFIX):
        return file_field[len(GENERATED_PREFIX):]
    return file_field


def build_generated_css(manifest: dict) -> str:
    # Verteidigung in der Tiefe: 'file' wird trotz validate_manifest() hier ERNEUT gegen
    # dasselbe sichere Zeichen-Muster geprueft, bevor es roh in einen CSS url(...)-Wert
    # eingesetzt wird - selbst ein von Hand manipuliertes Manifest kann so nicht aus dem
    # url(...) ausbrechen (siehe SAFE_MANIFEST_FILE_PATTERN).
    assets = sorted(
        (
            a
            for a in manifest.get("assets", [])
            if isinstance(a, dict)
            and a.get("id")
            and SAFE_MANIFEST_FILE_PATTERN.match(str(a.get("file", "")))
        ),
        key=lambda a: a["id"],
    )
    lines: list[str] = [
        "/* AUTOMATISCH GENERIERT von tools/asset-generator/generate_asset.py --rebuild-preview */",
        "/* Nicht von Hand bearbeiten - Aenderungen gehen beim naechsten Rebuild verloren. */",
        "/* Diese Datei wird vom bestehenden Spiel aktuell NICHT automatisch eingebunden. */",
        "",
        ":root {",
    ]
    for entry in assets:
        css_id = safe_css_id(entry["id"])
        rel = css_relative_path(str(entry.get("file", "")))
        lines.append(f'  --asset-{css_id}: url("./{rel}");')
    lines.append("}")
    lines.append("")

    for entry in assets:
        css_id = safe_css_id(entry["id"])
        lines.extend(
            [
                f".asset-{css_id} {{",
                f"  background-image: var(--asset-{css_id});",
                "  background-repeat: no-repeat;",
                "  background-position: center;",
                "  background-size: contain;",
                "}",
                "",
            ]
        )

    return "\n".join(lines).rstrip("\n") + "\n"


def write_generated_css(manifest: dict) -> None:
    atomic_write_text(GENERATED_CSS_PATH, build_generated_css(manifest))


# --------------------------------------------------------------------------
# Statische Vorschauseite (asset-preview.html)
# --------------------------------------------------------------------------


def _html_escape(value: object) -> str:
    import html

    return html.escape(str(value), quote=True)


def render_asset_card(entry: dict) -> str:
    asset_id = _html_escape(entry.get("id", ""))
    category = _html_escape(entry.get("category", ""))
    preset = _html_escape(entry.get("preset", ""))
    model = _html_escape(entry.get("model", ""))
    quality = _html_escape(entry.get("quality", ""))
    api_size = _html_escape(entry.get("api_size", ""))
    width = _html_escape(entry.get("final_width", "?"))
    height = _html_escape(entry.get("final_height", "?"))
    file_rel = _html_escape(entry.get("file", ""))
    created_at = _html_escape(entry.get("created_at", ""))
    has_alpha = "Ja" if entry.get("has_alpha") else "Nein"

    return f"""    <article class="asset-card" data-category="{category}" data-id="{asset_id}">
      <div class="asset-thumb-wrap">
        <img class="asset-thumb" src="{file_rel}" alt="{asset_id}" loading="lazy">
      </div>
      <h3 class="asset-id">{asset_id}</h3>
      <dl class="asset-meta">
        <div><dt>Kategorie</dt><dd>{category}</dd></div>
        <div><dt>Preset</dt><dd>{preset}</dd></div>
        <div><dt>Groesse</dt><dd>{width}&times;{height} <span class="asset-meta-sub">(API: {api_size})</span></dd></div>
        <div><dt>Modell</dt><dd>{model}</dd></div>
        <div><dt>Qualitaet</dt><dd>{quality}</dd></div>
        <div><dt>Pfad</dt><dd class="asset-meta-path">{file_rel}</dd></div>
        <div><dt>Alpha</dt><dd>{has_alpha}</dd></div>
        <div><dt>Erstellt</dt><dd>{created_at}</dd></div>
      </dl>
    </article>"""


EMPTY_STATE_HTML = """    <div class="empty-state">
      <p class="empty-state-emoji">&#127760;</p>
      <h2>Noch keine Assets generiert</h2>
      <p>
        Sobald du mit <code>--generate --confirm-api-call</code> dein erstes Asset erzeugt hast,
        erscheint es hier automatisch nach dem naechsten <code>--rebuild-preview</code>.
      </p>
      <p>Bis dahin: probiere <code>--dry-run</code>, um den geplanten Ablauf ohne API-Kosten zu sehen.</p>
    </div>"""


def build_preview_html(manifest: dict) -> str:
    assets = [a for a in manifest.get("assets", []) if isinstance(a, dict) and a.get("id")]
    sorted_assets = sorted(assets, key=lambda a: a["id"])
    cards_html = "\n".join(render_asset_card(a) for a in sorted_assets)
    body_content = cards_html if sorted_assets else EMPTY_STATE_HTML
    category_buttons = "\n".join(
        f'      <button type="button" class="filter-btn" data-category="{c}">{c}</button>'
        for c in ALLOWED_CATEGORIES
    )
    generated_at = _html_escape(iso_utc_now())
    count = len(sorted_assets)

    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BKMP Asset Generator</title>
<style>
  :root {{
    --bg: #0b0710;
    --panel: #150d20;
    --panel-border: #3a2a52;
    --accent: #a855f7;
    --accent-soft: #7c3aed;
    --gold: #d4af37;
    --text: #ece6f5;
    --muted: #a89bbf;
    --checker-a: #1a1224;
    --checker-b: #241736;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    background: radial-gradient(circle at top, #1c1128 0%, var(--bg) 60%);
    color: var(--text);
    font-family: "Segoe UI", Tahoma, Verdana, sans-serif;
    padding: 2rem 1.25rem 4rem;
  }}
  header.top {{
    max-width: 1200px;
    margin: 0 auto 1.5rem;
    text-align: center;
  }}
  header.top h1 {{
    margin: 0 0 0.35rem;
    font-size: 1.9rem;
    letter-spacing: 0.03em;
    background: linear-gradient(120deg, var(--gold), var(--accent));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }}
  header.top .subtitle {{ color: var(--muted); font-size: 0.95rem; margin: 0; }}
  .toolbar {{
    max-width: 1200px;
    margin: 0 auto 1.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    justify-content: center;
  }}
  .toolbar input[type="search"] {{
    flex: 1 1 240px;
    max-width: 340px;
    padding: 0.55rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    color: var(--text);
    font-size: 0.9rem;
  }}
  .filter-btn {{
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }}
  .filter-btn.active {{
    color: #0b0710;
    background: linear-gradient(120deg, var(--gold), var(--accent));
    border-color: transparent;
  }}
  .count-line {{
    max-width: 1200px;
    margin: 0 auto 1rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.85rem;
  }}
  .grid {{
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1.1rem;
  }}
  .asset-card {{
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }}
  .asset-card.hidden {{ display: none; }}
  .asset-thumb-wrap {{
    border-radius: 10px;
    overflow: hidden;
    background-image:
      linear-gradient(45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%),
      linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
    background-color: var(--checker-b);
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .asset-thumb {{ max-width: 100%; max-height: 100%; object-fit: contain; }}
  .asset-id {{ margin: 0; font-size: 1rem; color: var(--gold); word-break: break-all; }}
  .asset-meta {{ margin: 0; font-size: 0.78rem; color: var(--muted); display: grid; gap: 0.3rem; }}
  .asset-meta div {{ display: flex; justify-content: space-between; gap: 0.5rem; }}
  .asset-meta dt {{ color: var(--muted); }}
  .asset-meta dd {{ margin: 0; color: var(--text); text-align: right; }}
  .asset-meta-path {{ word-break: break-all; font-size: 0.72rem; }}
  .asset-meta-sub {{ color: var(--muted); font-size: 0.72rem; }}
  .empty-state {{
    max-width: 560px;
    margin: 3rem auto;
    text-align: center;
    background: var(--panel);
    border: 1px dashed var(--panel-border);
    border-radius: 16px;
    padding: 2.5rem 1.5rem;
    color: var(--muted);
  }}
  .empty-state-emoji {{ font-size: 2.4rem; margin: 0 0 0.5rem; }}
  .empty-state h2 {{ color: var(--text); margin: 0 0 0.6rem; }}
  .empty-state code {{
    background: rgba(168, 85, 247, 0.15);
    border-radius: 6px;
    padding: 0.1rem 0.4rem;
    color: var(--gold);
  }}
  footer.note {{
    max-width: 1200px;
    margin: 2.5rem auto 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.75rem;
  }}
</style>
</head>
<body>
  <header class="top">
    <h1>BKMP Asset Generator</h1>
    <p class="subtitle">Lokale Vorschau - generiert am {generated_at}</p>
  </header>

  <div class="toolbar">
    <input type="search" id="searchInput" placeholder="Nach Asset-ID suchen ...">
    <button type="button" class="filter-btn active" data-category="">Alle</button>
{category_buttons}
  </div>

  <p class="count-line" id="countLine">{count} Asset(s) im Manifest</p>

  <main class="grid" id="assetGrid">
{body_content}
  </main>

  <footer class="note">
    Rein statisch, keine externen Bibliotheken, kein Server noetig. Neu gebaut mit
    <code>--rebuild-preview</code> direkt aus asset-manifest.json.
  </footer>

  <script>
    (function () {{
      var search = document.getElementById("searchInput");
      var buttons = document.querySelectorAll(".filter-btn");
      var cards = document.querySelectorAll(".asset-card");
      var countLine = document.getElementById("countLine");
      var activeCategory = "";

      function applyFilters() {{
        var term = (search && search.value ? search.value : "").toLowerCase();
        var visible = 0;
        cards.forEach(function (card) {{
          var matchesCategory = !activeCategory || card.dataset.category === activeCategory;
          var matchesSearch = !term || card.dataset.id.indexOf(term) !== -1;
          var show = matchesCategory && matchesSearch;
          card.classList.toggle("hidden", !show);
          if (show) visible += 1;
        }});
        if (countLine) {{
          countLine.textContent = visible + " von " + cards.length + " Asset(s) sichtbar";
        }}
      }}

      buttons.forEach(function (btn) {{
        btn.addEventListener("click", function () {{
          buttons.forEach(function (b) {{ b.classList.remove("active"); }});
          btn.classList.add("active");
          activeCategory = btn.dataset.category || "";
          applyFilters();
        }});
      }});

      if (search) {{
        search.addEventListener("input", applyFilters);
      }}
    }})();
  </script>
</body>
</html>
"""


def write_preview_html(manifest: dict) -> None:
    atomic_write_text(PREVIEW_HTML_PATH, build_preview_html(manifest))


# --------------------------------------------------------------------------
# Bildverarbeitung (Pillow, nur lazy importiert - siehe run_real_generation)
# --------------------------------------------------------------------------


def trim_transparent_border(img):
    if img.mode != "RGBA":
        return img
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        return img
    return img.crop(bbox)


def apply_fit(img, target_w: int, target_h: int, fit: str, transparent_canvas: bool):
    from PIL import Image

    if fit == "stretch":
        return img.resize((target_w, target_h), Image.LANCZOS)

    src_w, src_h = img.size
    src_ratio = src_w / src_h
    dst_ratio = target_w / target_h

    if fit == "contain":
        if src_ratio > dst_ratio:
            new_w = target_w
            new_h = max(1, round(target_w / src_ratio))
        else:
            new_h = target_h
            new_w = max(1, round(target_h * src_ratio))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        canvas_mode = "RGBA" if transparent_canvas else "RGB"
        fill = (0, 0, 0, 0) if transparent_canvas else (0, 0, 0)
        canvas = Image.new(canvas_mode, (target_w, target_h), fill)
        offset = ((target_w - new_w) // 2, (target_h - new_h) // 2)
        if canvas_mode == "RGBA":
            if resized.mode != "RGBA":
                resized = resized.convert("RGBA")
            canvas.paste(resized, offset, resized)
        else:
            if resized.mode != "RGB":
                resized = resized.convert("RGB")
            canvas.paste(resized, offset)
        return canvas

    if fit == "cover":
        if src_ratio > dst_ratio:
            new_h = target_h
            new_w = max(1, round(target_h * src_ratio))
        else:
            new_w = target_w
            new_h = max(1, round(target_w / src_ratio))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - target_w) // 2
        top = (new_h - target_h) // 2
        return resized.crop((left, top, left + target_w, top + target_h))

    raise AssetGeneratorError(f"Unbekannter --fit Modus: {fit}")


def compute_has_alpha(img) -> bool:
    if img.mode not in ("RGBA", "LA"):
        return False
    alpha = img.split()[-1]
    lo, hi = alpha.getextrema()
    return lo < 255


# --------------------------------------------------------------------------
# Doctor / Validate / List-Presets / Rebuild-Preview
# --------------------------------------------------------------------------


def cmd_doctor() -> int:
    ok = True
    print("=== BKMP Asset Generator - Doctor ===\n")

    print(f"Python-Version: {sys.version.split()[0]}  ({sys.executable})")
    if sys.version_info < (3, 9):
        print("  [WARNUNG] Python 3.9+ wird empfohlen.")
        ok = False
    else:
        print("  OK")

    print(f"\nProjektpfad: {PROJECT_ROOT}")
    print(f"  Existiert: {'ja' if PROJECT_ROOT.is_dir() else 'nein'}")
    if not PROJECT_ROOT.is_dir():
        ok = False

    print("\nSchreibrechte:")
    for label, path in (
        ("Projekt-Root", PROJECT_ROOT),
        ("assets/generated", GENERATED_ASSETS_DIR),
        ("tools/asset-generator", TOOL_DIR),
    ):
        writable = check_writable(path)
        print(f"  {label}: {'OK' if writable else 'FEHLT / NICHT SCHREIBBAR'}")
        if not writable:
            ok = False

    print("\nVerzeichnisstruktur:")
    expected_paths = [
        TOOL_DIR / "generate_asset.py",
        PRESETS_PATH,
        TOOL_DIR / "requirements.txt",
        TOOL_DIR / "README.md",
        PROMPTS_DIR,
        TESTS_DIR,
        MANIFEST_PATH,
        PROJECT_ROOT / ".env.example",
    ] + [GENERATED_ASSETS_DIR / c for c in ALLOWED_CATEGORIES]
    for path in expected_paths:
        exists = path.exists()
        print(f"  {'OK' if exists else 'FEHLT'}: {describe_path_for_report(path)}")
        if not exists:
            ok = False

    print("\nAbhaengigkeiten (nur fuer --generate/.env.local noetig):")
    for module_name, pip_name in (("openai", "openai"), ("PIL", "Pillow"), ("dotenv", "python-dotenv")):
        available = is_importable(module_name)
        print(f"  {pip_name}: {'installiert' if available else 'nicht installiert'}")

    print("\nAPI-Konfiguration:")
    api_key_present = resolve_api_key() is not None
    print(f"  OPENAI_API_KEY vorhanden: {'ja' if api_key_present else 'nein'}")
    print(f"  OPENAI_IMAGE_MODEL: {resolve_model()}")
    print(f"  OPENAI_IMAGE_QUALITY: {resolve_quality_default()}")

    print("\nPresets:")
    try:
        presets = load_presets()
        preset_issues = validate_presets(presets)
        if preset_issues:
            ok = False
            for issue in preset_issues:
                print(f"  [FEHLER] {issue}")
        else:
            print(f"  OK ({len(presets)} Preset(s))")
    except AssetGeneratorError as exc:
        ok = False
        print(f"  [FEHLER] {exc}")

    print("\nManifest:")
    try:
        manifest = load_manifest()
        manifest_issues = validate_manifest(manifest)
        if manifest_issues:
            ok = False
            for issue in manifest_issues:
                print(f"  [FEHLER] {issue}")
        else:
            print(f"  OK ({len(manifest.get('assets', []))} Asset(s))")
    except AssetGeneratorError as exc:
        ok = False
        print(f"  [FEHLER] {exc}")

    print("\n=== Ergebnis ===")
    print("Alles bereit." if ok else "Es gibt Probleme, siehe oben.")
    return 0 if ok else 1


def cmd_list_presets() -> int:
    try:
        presets = load_presets()
    except AssetGeneratorError as exc:
        print(f"[Fehler] {exc}", file=sys.stderr)
        return 1

    print(f"Verfuegbare Presets ({len(presets)}):\n")
    for name in sorted(presets.keys()):
        preset = presets[name]
        print(f"- {name}")
        print(f"    {preset.get('description', '(keine Beschreibung)')}")
        print(
            f"    Kategorie: {preset.get('default_category')}   "
            f"Groesse: {preset.get('default_size')}   "
            f"Qualitaet: {preset.get('default_quality')}   "
            f"Hintergrund: {preset.get('default_background')}"
        )
        print()

    issues = validate_presets(presets)
    if issues:
        print("[Warnung] presets.json enthaelt Probleme:")
        for issue in issues:
            print(f"  - {issue}")
        return 1
    return 0


def cmd_validate() -> int:
    ok = True

    print("== Presets ==")
    try:
        presets = load_presets()
        preset_issues = validate_presets(presets)
    except AssetGeneratorError as exc:
        preset_issues = [str(exc)]
    if preset_issues:
        ok = False
        for issue in preset_issues:
            print(f"  [FEHLER] {issue}")
    else:
        print(f"  OK ({len(presets)} Preset(s))")

    print("== Manifest ==")
    manifest = None
    try:
        manifest = load_manifest()
        manifest_issues = validate_manifest(manifest)
    except AssetGeneratorError as exc:
        manifest_issues = [str(exc)]
    if manifest_issues:
        ok = False
        for issue in manifest_issues:
            print(f"  [FEHLER] {issue}")
    else:
        count = len(manifest.get("assets", [])) if manifest else 0
        print(f"  OK ({count} Asset(s))")

    print("== Verzeichnisstruktur ==")
    for category in ALLOWED_CATEGORIES:
        directory = GENERATED_ASSETS_DIR / category
        exists = directory.is_dir()
        print(f"  {'OK' if exists else 'FEHLT'}: {describe_path_for_report(directory)}")
        if not exists:
            ok = False

    if manifest and not manifest_issues:
        print("== Bildgroessen / Integritaet ==")
        good_entries = [a for a in manifest.get("assets", []) if isinstance(a, dict) and a.get("id")]
        if not good_entries:
            print("  (keine Assets zum Pruefen)")
        for entry in good_entries:
            deep_issues = deep_validate_asset_file(entry)
            if deep_issues:
                for issue in deep_issues:
                    print(f"  [FEHLER] {issue}")
                    if "Pillow nicht installiert" not in issue:
                        ok = False
            else:
                print(f"  OK: {entry.get('id')}")

    return 0 if ok else 1


def cmd_rebuild_preview() -> int:
    manifest = load_manifest()
    issues = validate_manifest(manifest)
    if issues:
        print("[Warnung] Manifest enthaelt Probleme, Preview wird trotzdem best-effort gebaut:")
        for issue in issues:
            print(f"  - {issue}")

    write_generated_css(manifest)
    write_preview_html(manifest)

    print(f"OK: {len(manifest.get('assets', []))} Asset(s) im Manifest.")
    print(f"Geschrieben: {describe_path_for_report(GENERATED_CSS_PATH)}")
    print(f"Geschrieben: {describe_path_for_report(PREVIEW_HTML_PATH)}")
    return 0


# --------------------------------------------------------------------------
# Dry-Run / echte Generierung
# --------------------------------------------------------------------------


def build_generation_plan(args: argparse.Namespace) -> dict:
    if args.prompt and args.prompt_file:
        raise AssetGeneratorError("--prompt und --prompt-file duerfen nicht gleichzeitig verwendet werden.")
    if not args.id:
        raise AssetGeneratorError("--id ist erforderlich.")
    if not args.category:
        raise AssetGeneratorError("--category ist erforderlich.")
    if not args.preset:
        raise AssetGeneratorError("--preset ist erforderlich.")
    if not args.prompt and not args.prompt_file:
        raise AssetGeneratorError("--prompt oder --prompt-file ist erforderlich.")

    asset_id = validate_asset_id(args.id)
    category = validate_category(args.category)
    presets = load_presets()
    preset = get_preset(args.preset, presets)

    if args.prompt_file:
        prompt_path = resolve_prompt_file(args.prompt_file)
        user_prompt = prompt_path.read_text(encoding="utf-8").strip()
        prompt_source_display = to_relative_posix(prompt_path)
    else:
        user_prompt = args.prompt.strip()
        prompt_source_display = "(inline --prompt)"

    if not user_prompt:
        raise AssetGeneratorError("Der Prompt darf nicht leer sein.")

    final_prompt = compose_prompt(preset, user_prompt)

    resolved_size = validate_size(args.size) if args.size else validate_size(preset["default_size"])
    resolved_quality = (
        validate_quality(args.quality) if args.quality else validate_quality(preset["default_quality"])
    )
    resolved_background = (
        validate_background(args.background)
        if args.background
        else validate_background(preset["default_background"])
    )
    model = resolve_model()

    if model == UNSUPPORTED_TRANSPARENT_MODEL and resolved_background == "transparent":
        raise AssetGeneratorError(
            f"Modell '{UNSUPPORTED_TRANSPARENT_MODEL}' unterstuetzt in dieser Konfiguration keinen "
            "transparenten Hintergrund (background=transparent). Bitte OPENAI_IMAGE_MODEL auf "
            "'gpt-image-1.5' setzen oder --background opaque/auto waehlen. Es wurde keine "
            "API-Anfrage gesendet."
        )

    filename = validate_filename(args.filename) if args.filename else f"{asset_id}.png"
    category_dir = GENERATED_ASSETS_DIR / category
    dest_path = category_dir / filename
    resolved_dest = dest_path.resolve()
    generated_root = GENERATED_ASSETS_DIR.resolve()
    if not resolved_dest.is_relative_to(generated_root):
        raise AssetGeneratorError("Ungueltiger Zielpfad (liegt ausserhalb von assets/generated).")

    target_size = parse_target_size(args.target_size) if args.target_size else None
    fit = args.fit if args.fit else ("cover" if category == "backgrounds" else "contain")
    validate_fit(fit)

    manifest = load_manifest()
    existing_entry = find_asset_by_id(manifest, asset_id)
    file_already_exists = dest_path.exists()

    return {
        "asset_id": asset_id,
        "category": category,
        "preset_name": args.preset,
        "prompt_source_display": prompt_source_display,
        "final_prompt": final_prompt,
        "model": model,
        "resolved_size": resolved_size,
        "resolved_quality": resolved_quality,
        "resolved_background": resolved_background,
        "filename": filename,
        "dest_path": dest_path,
        "target_size": target_size,
        "fit": fit,
        "manifest": manifest,
        "existing_entry": existing_entry,
        "file_already_exists": file_already_exists,
        "trim_transparent": bool(args.trim_transparent),
        "force": bool(args.force),
    }


def print_dry_run_plan(plan: dict) -> None:
    print("=== DRY RUN: Es wird KEINE API-Anfrage gesendet ===\n")
    print(f"Asset-ID:        {plan['asset_id']}")
    print(f"Kategorie:       {plan['category']}")
    print(f"Preset:          {plan['preset_name']}")
    print(f"Ausgabepfad:     {describe_path_for_report(plan['dest_path'])}")
    print(f"Modell:          {plan['model']}")
    print(f"Groesse (API):   {plan['resolved_size']}")
    print(f"Qualitaet:       {plan['resolved_quality']}")
    print(f"Hintergrund:     {plan['resolved_background']}")
    print(f"Fit-Modus:       {plan['fit']}")
    if plan["target_size"]:
        print(f"Ziel-Groesse:    {plan['target_size'][0]}x{plan['target_size'][1]}")
    else:
        print("Ziel-Groesse:    (keine - Original-API-Groesse bleibt erhalten)")
    print(f"Trim transparent: {'ja' if plan['trim_transparent'] else 'nein'}")
    print(f"Prompt-Quelle:   {plan['prompt_source_display']}")
    print("\nFinal zusammengesetzter Prompt:")
    print("-" * 60)
    print(plan["final_prompt"])
    print("-" * 60)

    print("\nGeplante Manifestdaten (Vorschau, wird bei --dry-run NICHT geschrieben):")
    preview_entry = {
        "id": plan["asset_id"],
        "category": plan["category"],
        "file": to_relative_posix(plan["dest_path"]),
        "preset": plan["preset_name"],
        "prompt_source": plan["prompt_source_display"],
        "model": plan["model"],
        "api_size": plan["resolved_size"],
        "final_width": (plan["target_size"][0] if plan["target_size"] else "(wie API-Antwort)"),
        "final_height": (plan["target_size"][1] if plan["target_size"] else "(wie API-Antwort)"),
        "quality": plan["resolved_quality"],
        "background": plan["resolved_background"],
        "fit": plan["fit"],
        "sha256": "(erst nach echter Generierung bekannt)",
        "created_at": "(erst nach echter Generierung bekannt)",
        "has_alpha": "(erst nach echter Generierung bekannt)",
    }
    print(json.dumps(preview_entry, indent=2, ensure_ascii=False))

    if plan["file_already_exists"] or plan["existing_entry"]:
        print(
            "\n[Hinweis] Datei und/oder Manifest-Eintrag fuer diese ID existieren bereits. "
            "Eine echte Generierung wuerde ohne --force abgelehnt."
        )

    print("\n>>> Kein API-Aufruf durchgefuehrt (--dry-run). Keine Kosten entstanden. <<<")


def call_openai_with_retries(client, openai_sdk, request_kwargs: dict, max_retries: int = 2):
    retryable = tuple(
        cls
        for cls in (
            getattr(openai_sdk, "RateLimitError", None),
            getattr(openai_sdk, "APIConnectionError", None),
            getattr(openai_sdk, "APITimeoutError", None),
            getattr(openai_sdk, "InternalServerError", None),
        )
        if cls is not None
    )
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return client.images.generate(**request_kwargs)
        except retryable as exc:  # type: ignore[misc]
            last_exc = exc
            if attempt >= max_retries:
                raise
            wait_seconds = 1.5 * (2 ** attempt)
            print(
                f"[Warnung] Temporaerer Fehler ({type(exc).__name__}), "
                f"Wiederholung in {wait_seconds:.1f}s ..."
            )
            time.sleep(wait_seconds)
    if last_exc:
        raise last_exc
    raise AssetGeneratorError("Unerwarteter Zustand bei der API-Anfrage.")


def run_real_generation(plan: dict) -> int:
    try:
        from openai import OpenAI
        import openai as openai_sdk
    except ImportError as exc:
        raise AssetGeneratorError(
            "Paket 'openai' ist nicht installiert. Bitte zuerst "
            "'py -m pip install -r tools/asset-generator/requirements.txt' ausfuehren."
        ) from exc
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise AssetGeneratorError(
            "Paket 'Pillow' ist nicht installiert. Bitte zuerst "
            "'py -m pip install -r tools/asset-generator/requirements.txt' ausfuehren."
        ) from exc

    api_key = resolve_api_key()
    if not api_key:
        raise AssetGeneratorError(
            "Kein OPENAI_API_KEY gefunden (weder in der Umgebung noch in .env.local). "
            "Siehe .env.example."
        )

    client = OpenAI(api_key=api_key)
    print(
        f"[Info] Sende Anfrage an OpenAI Images API (Modell: {plan['model']}, "
        f"Groesse: {plan['resolved_size']}, Qualitaet: {plan['resolved_quality']}, "
        f"Hintergrund: {plan['resolved_background']}) ..."
    )

    request_kwargs = {
        "model": plan["model"],
        "prompt": plan["final_prompt"],
        "size": plan["resolved_size"],
        "quality": plan["resolved_quality"],
        "background": plan["resolved_background"],
        "n": 1,
    }

    try:
        response = call_openai_with_retries(client, openai_sdk, request_kwargs)
    except Exception as exc:
        request_id = getattr(exc, "request_id", None)
        message = f"OpenAI-Anfrage fehlgeschlagen ({type(exc).__name__})."
        if request_id:
            message += f" Request-ID: {request_id}"
        raise AssetGeneratorError(message) from exc

    try:
        b64_data = response.data[0].b64_json
    except Exception as exc:
        raise AssetGeneratorError("Unerwartetes Antwortformat der OpenAI API (kein b64_json gefunden).") from exc
    if not b64_data:
        raise AssetGeneratorError("OpenAI API hat kein Bild zurueckgegeben.")

    try:
        raw_bytes = base64.b64decode(b64_data)
    except Exception as exc:
        raise AssetGeneratorError("Antwort konnte nicht als Base64 dekodiert werden.") from exc

    category_dir = plan["dest_path"].parent
    category_dir.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        prefix=f"{plan['asset_id']}-", suffix=".png.tmp", dir=str(category_dir)
    )
    tmp_path = Path(tmp_name)

    final_bytes = None
    final_width = final_height = None
    has_alpha = False

    try:
        with os.fdopen(tmp_fd, "wb") as fh:
            fh.write(raw_bytes)
            fh.flush()
            os.fsync(fh.fileno())

        try:
            with Image.open(tmp_path) as verify_img:
                verify_img.verify()
        except UnidentifiedImageError as exc:
            raise AssetGeneratorError("Die erhaltenen Bilddaten sind kein gueltiges PNG.") from exc

        with Image.open(tmp_path) as img:
            img.load()
            if img.mode not in ("RGBA", "RGB", "LA", "L"):
                img = img.convert("RGBA")
            if plan["trim_transparent"]:
                img = trim_transparent_border(img)
            if plan["target_size"]:
                transparent_canvas = plan["resolved_background"] == "transparent"
                img = apply_fit(img, plan["target_size"][0], plan["target_size"][1], plan["fit"], transparent_canvas)
            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            final_bytes = buffer.getvalue()
            final_width, final_height = img.size
            has_alpha = compute_has_alpha(img)
    except AssetGeneratorError:
        raise
    except Exception as exc:
        raise AssetGeneratorError(f"Bildverarbeitung fehlgeschlagen: {exc}") from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    sha256_hex = sha256_of_bytes(final_bytes)

    try:
        atomic_write_bytes(plan["dest_path"], final_bytes)
    except Exception as exc:
        raise AssetGeneratorError(f"Bild konnte nicht gespeichert werden: {exc}") from exc

    entry = {
        "id": plan["asset_id"],
        "category": plan["category"],
        "file": to_relative_posix(plan["dest_path"]),
        "preset": plan["preset_name"],
        "prompt_source": plan["prompt_source_display"],
        "model": plan["model"],
        "api_size": plan["resolved_size"],
        "final_width": final_width,
        "final_height": final_height,
        "quality": plan["resolved_quality"],
        "background": plan["resolved_background"],
        "fit": plan["fit"],
        "sha256": sha256_hex,
        "created_at": iso_utc_now(),
        "has_alpha": has_alpha,
    }

    # Manifest unmittelbar vor dem Schreiben FRISCH von der Platte laden (nicht die beim
    # Plan-Aufbau evtl. laengst veraltete plan["manifest"]-Momentaufnahme) - verkleinert
    # das Risiko, dass ein zweiter, parallel laufender Aufruf fuer eine ANDERE Asset-ID
    # den Eintrag dieses Laufs beim Schreiben stillschweigend wieder verwirft.
    try:
        fresh_manifest = load_manifest()
    except AssetGeneratorError:
        fresh_manifest = plan["manifest"]

    if not plan["force"] and find_asset_by_id(fresh_manifest, plan["asset_id"]) is not None:
        raise AssetGeneratorError(
            f"Asset '{plan['asset_id']}' wurde zwischenzeitlich (z.B. von einem anderen "
            "gleichzeitig laufenden Aufruf) im Manifest angelegt - Nutze --force zum "
            f"gezielten Ueberschreiben. Das Bild wurde bereits gespeichert: "
            f"{describe_path_for_report(plan['dest_path'])}"
        )

    try:
        upsert_manifest_entry(fresh_manifest, entry, force=plan["force"])
        write_manifest_atomic(fresh_manifest)
    except Exception as exc:
        raise AssetGeneratorError(
            f"Bild wurde gespeichert, aber Manifest konnte nicht aktualisiert werden: {exc}"
        ) from exc

    print(
        f"[OK] Asset '{plan['asset_id']}' gespeichert: {describe_path_for_report(plan['dest_path'])} "
        f"({final_width}x{final_height}, Alpha: {'ja' if has_alpha else 'nein'})"
    )
    print("Tipp: 'py tools/asset-generator/generate_asset.py --rebuild-preview' ausfuehren, "
          "um die Vorschauseite zu aktualisieren.")
    return 0


def cmd_generate_or_dry_run(args: argparse.Namespace) -> int:
    plan = build_generation_plan(args)

    if args.dry_run:
        print_dry_run_plan(plan)
        return 0

    if not args.generate:
        # Unerreichbar ueber die normale CLI-Weiche in main(), aber sicherheitshalber:
        return 0

    if not args.confirm_api_call:
        raise AssetGeneratorError(
            "Echte Generierung erfordert SOWOHL --generate ALS AUCH --confirm-api-call "
            "(kostenpflichtige API-Anfrage, muss bewusst bestaetigt werden). "
            "Es wurde keine API-Anfrage gesendet."
        )

    if (plan["file_already_exists"] or plan["existing_entry"]) and not plan["force"]:
        raise AssetGeneratorError(
            f"Asset '{plan['asset_id']}' existiert bereits (Datei und/oder Manifest-Eintrag). "
            "Nutze --force zum gezielten Ueberschreiben. Es wurde keine API-Anfrage gesendet."
        )

    return run_real_generation(plan)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="generate_asset.py",
        description="BKMP Fantasy Asset Generator - lokal, sicher, projektunabhaengig.",
        exit_on_error=False,
    )
    parser.add_argument("--doctor", action="store_true", help="Umgebung/Konfiguration pruefen.")
    parser.add_argument("--list-presets", action="store_true", help="Verfuegbare Presets anzeigen.")
    parser.add_argument("--preset", help="Preset-Name aus presets.json.")
    parser.add_argument("--id", help="Eindeutige Asset-ID in kebab-case, z.B. upgrade-hammer.")
    parser.add_argument("--category", choices=list(ALLOWED_CATEGORIES), help="Zielkategorie.")
    parser.add_argument("--prompt", help="Inline-Prompt-Text.")
    parser.add_argument("--prompt-file", help="Pfad zu einer UTF-8-Prompt-Datei.")
    parser.add_argument("--filename", help="Optionaler Dateiname (Standard: <ID>.png).")
    parser.add_argument("--size", choices=list(ALLOWED_SIZES), help="API-Bildgroesse.")
    parser.add_argument("--quality", choices=list(ALLOWED_QUALITIES), help="API-Qualitaet.")
    parser.add_argument("--background", choices=list(ALLOWED_BACKGROUNDS), help="API-Hintergrund.")
    parser.add_argument("--target-size", help="Lokales Endformat, z.B. 256x256.")
    parser.add_argument("--fit", choices=list(ALLOWED_FITS), help="contain/cover/stretch.")
    parser.add_argument(
        "--trim-transparent", action="store_true", help="Transparente Aussenraender lokal entfernen."
    )
    parser.add_argument("--dry-run", action="store_true", help="Plan anzeigen, KEINE API-Anfrage.")
    parser.add_argument("--generate", action="store_true", help="Echte (kostenpflichtige) Generierung aktivieren.")
    parser.add_argument(
        "--confirm-api-call", action="store_true", help="Pflichtbestaetigung fuer --generate."
    )
    parser.add_argument("--force", action="store_true", help="Bestehendes Asset gezielt ueberschreiben.")
    parser.add_argument(
        "--rebuild-preview", action="store_true", help="asset-preview.html + CSS aus dem Manifest neu bauen."
    )
    parser.add_argument("--validate", action="store_true", help="Presets/Manifest/Dateien pruefen.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except argparse.ArgumentError as exc:
        print(f"[Fehler] Ungueltige Argumente: {exc}", file=sys.stderr)
        return 2

    try:
        if args.doctor:
            return cmd_doctor()
        if args.list_presets:
            return cmd_list_presets()
        if args.validate:
            return cmd_validate()
        if args.rebuild_preview:
            return cmd_rebuild_preview()
        if args.dry_run or args.generate:
            return cmd_generate_or_dry_run(args)
        parser.print_help()
        return 1
    except AssetGeneratorError as exc:
        print(f"[Fehler] {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # unerwarteter Fehler, z.B. aus openai/Pillow-Internas
        request_id = getattr(exc, "request_id", None)
        print(f"[Fehler] Unerwarteter Fehler ({type(exc).__name__}).", file=sys.stderr)
        if request_id:
            print(f"  Request-ID: {request_id}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
