"""Unit-Tests fuer generate_asset.py.

Regeln (siehe auch tools/asset-generator/README.md):
- Keine Netzwerkverbindung, keine echte OpenAI-Anfrage.
- Keine echten Projektassets/-dateien werden veraendert - jeder Schreibtest
  laeuft in einem frischen tempfile.TemporaryDirectory() mit monkeygepatchten
  Modul-Pfadkonstanten (siehe IsolatedProjectTestCase).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_TOOL_DIR = Path(__file__).resolve().parents[1]
if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))

import generate_asset as ga  # noqa: E402


def _sample_presets() -> dict:
    return {
        "fantasy-icon": {
            "description": "Test-Icon-Preset",
            "default_category": "icons",
            "default_size": "1024x1024",
            "default_quality": "medium",
            "default_background": "transparent",
            "prompt_prefix": "PREFIX",
            "prompt_suffix": "SUFFIX",
        },
        "fantasy-background": {
            "description": "Test-Hintergrund-Preset",
            "default_category": "backgrounds",
            "default_size": "1536x1024",
            "default_quality": "high",
            "default_background": "opaque",
            "prompt_prefix": "BG-PREFIX",
            "prompt_suffix": "BG-SUFFIX",
        },
    }


def make_args(**overrides) -> argparse.Namespace:
    defaults = dict(
        doctor=False,
        list_presets=False,
        preset="fantasy-icon",
        id="test-upgrade-hammer",
        category="icons",
        prompt="A test prompt.",
        prompt_file=None,
        filename=None,
        size=None,
        quality=None,
        background=None,
        target_size=None,
        fit=None,
        trim_transparent=False,
        dry_run=False,
        generate=False,
        confirm_api_call=False,
        force=False,
        rebuild_preview=False,
        validate=False,
    )
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


PATCHED_ATTRS = (
    "PROJECT_ROOT",
    "TOOL_DIR",
    "PROMPTS_DIR",
    "TESTS_DIR",
    "PRESETS_PATH",
    "MANIFEST_PATH",
    "PREVIEW_HTML_PATH",
    "ENV_LOCAL_PATH",
    "GENERATED_ASSETS_DIR",
    "GENERATED_CSS_PATH",
)


class IsolatedProjectTestCase(unittest.TestCase):
    """Baut pro Test ein frisches Fake-Projekt in einem tempdir und
    monkeypatcht die Modul-Pfadkonstanten dorthin. Beruehrt nie das echte
    Repository (kein Netzwerk, keine echten Assets)."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory(prefix="bkmp-asset-gen-test-")
        self.root = Path(self._tmpdir.name)

        self.tool_dir = self.root / "tools" / "asset-generator"
        self.prompts_dir = self.tool_dir / "prompts"
        self.tests_dir = self.tool_dir / "tests"
        self.presets_path = self.tool_dir / "presets.json"
        self.manifest_path = self.root / "asset-manifest.json"
        self.preview_html_path = self.root / "asset-preview.html"
        self.env_local_path = self.root / ".env.local"
        self.generated_dir = self.root / "assets" / "generated"
        self.generated_css_path = self.generated_dir / "generated-assets.css"

        for category in ga.ALLOWED_CATEGORIES:
            (self.generated_dir / category).mkdir(parents=True, exist_ok=True)
        self.prompts_dir.mkdir(parents=True, exist_ok=True)
        self.tests_dir.mkdir(parents=True, exist_ok=True)

        self.presets_path.write_text(
            json.dumps(_sample_presets(), indent=2, ensure_ascii=False), encoding="utf-8"
        )
        self.manifest_path.write_text(
            json.dumps({"version": 1, "updated_at": None, "assets": []}, indent=2) + "\n",
            encoding="utf-8",
        )

        replacements = {
            "PROJECT_ROOT": self.root,
            "TOOL_DIR": self.tool_dir,
            "PROMPTS_DIR": self.prompts_dir,
            "TESTS_DIR": self.tests_dir,
            "PRESETS_PATH": self.presets_path,
            "MANIFEST_PATH": self.manifest_path,
            "PREVIEW_HTML_PATH": self.preview_html_path,
            "ENV_LOCAL_PATH": self.env_local_path,
            "GENERATED_ASSETS_DIR": self.generated_dir,
            "GENERATED_CSS_PATH": self.generated_css_path,
        }
        self._originals = {name: getattr(ga, name) for name in PATCHED_ATTRS}
        for name, value in replacements.items():
            setattr(ga, name, value)

        self._env_backup = dict(os.environ)
        for key in ("OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "OPENAI_IMAGE_QUALITY"):
            os.environ.pop(key, None)

    def tearDown(self) -> None:
        for name, value in self._originals.items():
            setattr(ga, name, value)
        os.environ.clear()
        os.environ.update(self._env_backup)
        self._tmpdir.cleanup()


# --------------------------------------------------------------------------
# Reine Validierungsfunktionen (keine Dateisystem-Isolation noetig)
# --------------------------------------------------------------------------


class TestAssetIdValidation(unittest.TestCase):
    def test_valid_kebab_case_ids_accepted(self):
        for good in ("upgrade-hammer", "a1-b2-c3", "single", "test-upgrade-hammer"):
            self.assertEqual(ga.validate_asset_id(good), good)

    def test_invalid_ids_rejected(self):
        for bad in ("Upgrade-Hammer", "upgrade hammer", "upgrade--hammer", "-upgrade", "upgrade-", "", "UPPER", "a_b"):
            with self.assertRaises(ga.AssetGeneratorError):
                ga.validate_asset_id(bad)

    def test_dotdot_rejected(self):
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_asset_id("../evil")
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_asset_id("evil..name")

    def test_path_separators_rejected(self):
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_asset_id("foo/bar")
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_asset_id("foo\\bar")


class TestCategoryValidation(unittest.TestCase):
    def test_valid_categories_accepted(self):
        for category in ga.ALLOWED_CATEGORIES:
            self.assertEqual(ga.validate_category(category), category)

    def test_invalid_category_rejected(self):
        for bad in ("weapons", "../icons", "Icons", "", "icons/../buttons"):
            with self.assertRaises(ga.AssetGeneratorError):
                ga.validate_category(bad)


class TestFilenameValidation(unittest.TestCase):
    def test_valid_filename_accepted(self):
        self.assertEqual(ga.validate_filename("upgrade-hammer.png"), "upgrade-hammer.png")

    def test_path_separators_rejected(self):
        for bad in ("sub/evil.png", "sub\\evil.png", "..\\evil.png", "../evil.png", "/etc/evil.png"):
            with self.assertRaises(ga.AssetGeneratorError):
                ga.validate_filename(bad)

    def test_wrong_extension_rejected(self):
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_filename("evil.exe")

    def test_empty_filename_rejected(self):
        with self.assertRaises(ga.AssetGeneratorError):
            ga.validate_filename("")


class TestPromptComposition(unittest.TestCase):
    def test_compose_prompt_includes_prefix_user_suffix_in_order(self):
        preset = {"prompt_prefix": "PREFIX-TEXT", "prompt_suffix": "SUFFIX-TEXT"}
        result = ga.compose_prompt(preset, "USER PROMPT TEXT")
        self.assertIn("PREFIX-TEXT", result)
        self.assertIn("USER PROMPT TEXT", result)
        self.assertIn("SUFFIX-TEXT", result)
        self.assertLess(result.index("PREFIX-TEXT"), result.index("USER PROMPT TEXT"))
        self.assertLess(result.index("USER PROMPT TEXT"), result.index("SUFFIX-TEXT"))


class TestCssIdSafety(unittest.TestCase):
    def test_safe_css_id_sanitizes_unsafe_characters(self):
        self.assertEqual(ga.safe_css_id("upgrade-hammer"), "upgrade-hammer")
        self.assertEqual(ga.safe_css_id("Weird ID!!"), "weird-id")
        self.assertEqual(ga.safe_css_id("--leading--trailing--"), "leading-trailing")
        self.assertEqual(ga.safe_css_id(""), "asset")
        self.assertEqual(ga.safe_css_id("a</style>b"), "a-style-b")


class TestPreviewEscaping(unittest.TestCase):
    def test_render_asset_card_escapes_html(self):
        entry = {
            "id": "safe-id",
            "category": "icons",
            "preset": "<script>alert(1)</script>",
            "model": "gpt-image-1.5",
            "quality": "medium",
            "api_size": "1024x1024",
            "final_width": 256,
            "final_height": 256,
            "file": "assets/generated/icons/safe-id.png",
            "created_at": "2026-01-01T00:00:00Z",
            "has_alpha": True,
        }
        card_html = ga.render_asset_card(entry)
        self.assertNotIn("<script>alert(1)</script>", card_html)
        self.assertIn("&lt;script&gt;", card_html)

    def test_build_preview_html_shows_empty_state_without_assets(self):
        manifest = {"version": 1, "updated_at": None, "assets": []}
        html_out = ga.build_preview_html(manifest)
        self.assertIn("Noch keine Assets generiert", html_out)
        self.assertIn("BKMP Asset Generator", html_out)


# --------------------------------------------------------------------------
# Tests, die ein isoliertes Fake-Projekt brauchen
# --------------------------------------------------------------------------


class TestPresetsLoading(IsolatedProjectTestCase):
    def test_presets_load_successfully(self):
        presets = ga.load_presets()
        self.assertIn("fantasy-icon", presets)
        self.assertIn("fantasy-background", presets)

    def test_unknown_preset_raises(self):
        presets = ga.load_presets()
        with self.assertRaises(ga.AssetGeneratorError):
            ga.get_preset("does-not-exist", presets)

    def test_validate_presets_detects_incomplete_entry(self):
        presets = ga.load_presets()
        presets["broken"] = {"description": "missing everything else"}
        issues = ga.validate_presets(presets)
        self.assertTrue(any("broken" in issue for issue in issues))


class TestManifestHandling(IsolatedProjectTestCase):
    def test_manifest_loads_and_validates_clean(self):
        manifest = ga.load_manifest()
        self.assertEqual(ga.validate_manifest(manifest), [])

    def test_validate_manifest_detects_duplicate_ids(self):
        manifest = {
            "version": 1,
            "updated_at": None,
            "assets": [
                {"id": "a", "category": "icons", "file": "assets/generated/icons/a.png"},
                {"id": "a", "category": "icons", "file": "assets/generated/icons/a2.png"},
            ],
        }
        issues = ga.validate_manifest(manifest)
        self.assertTrue(any("doppelte id" in issue for issue in issues))

    def test_validate_manifest_detects_path_outside_generated(self):
        manifest = {
            "version": 1,
            "updated_at": None,
            "assets": [{"id": "a", "category": "icons", "file": "../evil.png"}],
        }
        issues = ga.validate_manifest(manifest)
        self.assertTrue(len(issues) >= 1)

    def test_manifest_write_is_atomic_no_leftover_tmp_file(self):
        manifest = ga.load_manifest()
        (self.generated_dir / "icons" / "sample.png").write_bytes(b"PNGDATA")
        manifest["assets"].append(
            {"id": "sample", "category": "icons", "file": "assets/generated/icons/sample.png"}
        )
        ga.write_manifest_atomic(manifest)

        reloaded = ga.load_manifest()
        self.assertEqual(len(reloaded["assets"]), 1)
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_manifest_write_failure_leaves_no_tmp_and_no_corruption(self):
        manifest = ga.load_manifest()
        manifest["assets"].append(
            {"id": "sample", "category": "icons", "file": "assets/generated/icons/sample.png"}
        )
        with mock.patch("os.replace", side_effect=OSError("simulated failure")):
            with self.assertRaises(OSError):
                ga.write_manifest_atomic(manifest)

        self.assertEqual(list(self.root.glob("*.tmp")), [])
        reloaded = ga.load_manifest()
        self.assertEqual(reloaded["assets"], [])


class TestDryRun(IsolatedProjectTestCase):
    def test_dry_run_without_api_key_succeeds(self):
        self.assertIsNone(os.environ.get("OPENAI_API_KEY"))
        args = make_args(dry_run=True, target_size="256x256")
        exit_code = ga.cmd_generate_or_dry_run(args)
        self.assertEqual(exit_code, 0)

    def test_dry_run_does_not_write_png(self):
        args = make_args(dry_run=True, target_size="256x256")
        ga.cmd_generate_or_dry_run(args)
        icons_dir = self.generated_dir / "icons"
        self.assertEqual(list(icons_dir.iterdir()), [])

    def test_dry_run_does_not_modify_manifest(self):
        before = self.manifest_path.read_text(encoding="utf-8")
        args = make_args(dry_run=True)
        ga.cmd_generate_or_dry_run(args)
        after = self.manifest_path.read_text(encoding="utf-8")
        self.assertEqual(before, after)

    def test_dry_run_never_calls_real_generation(self):
        args = make_args(dry_run=True, generate=True, confirm_api_call=True)
        with mock.patch.object(ga, "run_real_generation") as mocked:
            exit_code = ga.cmd_generate_or_dry_run(args)
            mocked.assert_not_called()
        self.assertEqual(exit_code, 0)


class TestConfirmApiCallGate(IsolatedProjectTestCase):
    def test_generate_without_confirm_does_not_call_api(self):
        args = make_args(generate=True, confirm_api_call=False)
        with mock.patch.object(ga, "run_real_generation") as mocked:
            with self.assertRaises(ga.AssetGeneratorError):
                ga.cmd_generate_or_dry_run(args)
            mocked.assert_not_called()


class TestOverwriteProtection(IsolatedProjectTestCase):
    def test_existing_file_not_overwritten_without_force(self):
        dest = self.generated_dir / "icons" / "test-upgrade-hammer.png"
        dest.write_bytes(b"ORIGINAL-DATA")

        args = make_args(generate=True, confirm_api_call=True, force=False)
        with mock.patch.object(ga, "run_real_generation") as mocked:
            with self.assertRaises(ga.AssetGeneratorError):
                ga.cmd_generate_or_dry_run(args)
            mocked.assert_not_called()

        self.assertEqual(dest.read_bytes(), b"ORIGINAL-DATA")

    def test_existing_manifest_entry_blocked_without_force(self):
        manifest = ga.load_manifest()
        (self.generated_dir / "icons" / "test-upgrade-hammer.png").write_bytes(b"X")
        manifest["assets"].append(
            {"id": "test-upgrade-hammer", "category": "icons", "file": "assets/generated/icons/test-upgrade-hammer.png"}
        )
        ga.write_manifest_atomic(manifest)

        args = make_args(generate=True, confirm_api_call=True, force=False)
        with mock.patch.object(ga, "run_real_generation") as mocked:
            with self.assertRaises(ga.AssetGeneratorError):
                ga.cmd_generate_or_dry_run(args)
            mocked.assert_not_called()


class TestModelBackgroundGuard(IsolatedProjectTestCase):
    def test_gpt_image_2_with_transparent_background_rejected_before_plan_completes(self):
        os.environ["OPENAI_IMAGE_MODEL"] = "gpt-image-2"
        args = make_args(preset="fantasy-icon", background="transparent", dry_run=True)
        with self.assertRaises(ga.AssetGeneratorError):
            ga.build_generation_plan(args)

    def test_gpt_image_2_with_opaque_background_allowed(self):
        os.environ["OPENAI_IMAGE_MODEL"] = "gpt-image-2"
        args = make_args(preset="fantasy-background", id="bg-test", category="backgrounds", background="opaque", dry_run=True)
        plan = ga.build_generation_plan(args)
        self.assertEqual(plan["resolved_background"], "opaque")


class TestPathContainment(IsolatedProjectTestCase):
    def test_dest_path_stays_inside_generated_dir(self):
        args = make_args(dry_run=True)
        plan = ga.build_generation_plan(args)
        resolved = plan["dest_path"].resolve()
        self.assertTrue(resolved.is_relative_to(self.generated_dir.resolve()))

    def test_filename_traversal_rejected_before_plan(self):
        args = make_args(dry_run=True, filename="../../evil.png")
        with self.assertRaises(ga.AssetGeneratorError):
            ga.build_generation_plan(args)


class TestRebuildPreview(IsolatedProjectTestCase):
    def test_rebuild_preview_builds_css_and_html_from_manifest(self):
        manifest = ga.load_manifest()
        (self.generated_dir / "icons" / "sample.png").write_bytes(b"PNGDATA")
        manifest["assets"].append(
            {
                "id": "sample",
                "category": "icons",
                "file": "assets/generated/icons/sample.png",
                "preset": "fantasy-icon",
                "model": "gpt-image-1.5",
                "api_size": "1024x1024",
                "final_width": 256,
                "final_height": 256,
                "quality": "medium",
                "background": "transparent",
                "fit": "contain",
                "sha256": "abc123",
                "created_at": "2026-01-01T00:00:00Z",
                "has_alpha": True,
            }
        )
        ga.write_manifest_atomic(manifest)

        exit_code = ga.cmd_rebuild_preview()
        self.assertEqual(exit_code, 0)
        self.assertTrue(self.preview_html_path.is_file())
        self.assertTrue(self.generated_css_path.is_file())

        css_text = self.generated_css_path.read_text(encoding="utf-8")
        self.assertIn("--asset-sample", css_text)

        html_text = self.preview_html_path.read_text(encoding="utf-8")
        self.assertIn("sample", html_text)
        self.assertNotIn("Noch keine Assets generiert", html_text)

    def test_rebuild_preview_on_empty_manifest_shows_empty_state(self):
        exit_code = ga.cmd_rebuild_preview()
        self.assertEqual(exit_code, 0)
        html_text = self.preview_html_path.read_text(encoding="utf-8")
        self.assertIn("Noch keine Assets generiert", html_text)


class TestValidateCommand(IsolatedProjectTestCase):
    def test_validate_passes_on_clean_setup(self):
        exit_code = ga.cmd_validate()
        self.assertEqual(exit_code, 0)

    def test_validate_fails_on_broken_manifest(self):
        self.manifest_path.write_text("{not valid json", encoding="utf-8")
        exit_code = ga.cmd_validate()
        self.assertNotEqual(exit_code, 0)


class TestDoctorCommand(IsolatedProjectTestCase):
    def test_doctor_reports_ok_without_api_key(self):
        # --doctor darf niemals fehlschlagen, nur weil kein API-Key gesetzt ist -
        # das ist ein normaler, erwarteter lokaler Zustand.
        (self.tool_dir / "generate_asset.py").write_text("# placeholder", encoding="utf-8")
        (self.tool_dir / "requirements.txt").write_text("openai\n", encoding="utf-8")
        (self.tool_dir / "README.md").write_text("# placeholder", encoding="utf-8")
        (self.root / ".env.example").write_text("OPENAI_API_KEY=\n", encoding="utf-8")
        exit_code = ga.cmd_doctor()
        self.assertEqual(exit_code, 0)


# --------------------------------------------------------------------------
# Regressionstests fuer die adversariale Sicherheitspruefung (05.08.2026):
# --prompt-file durfte zuvor ungefiltert JEDE lokale Datei lesen, inkl. einer
# echten .env.local mit dem API-Key - per Dry-Run bewiesen und hier fixiert.
# --------------------------------------------------------------------------


class TestPromptFileSecretGuard(IsolatedProjectTestCase):
    def test_prompt_file_blocks_env_local(self):
        self.env_local_path.write_text("OPENAI_API_KEY=sk-should-never-leak\n", encoding="utf-8")
        args = make_args(dry_run=True, prompt=None, prompt_file=str(self.env_local_path))
        with self.assertRaises(ga.AssetGeneratorError):
            ga.build_generation_plan(args)

    def test_prompt_file_blocks_env_example_too(self):
        env_example = self.root / ".env.example"
        env_example.write_text("OPENAI_API_KEY=\n", encoding="utf-8")
        args = make_args(dry_run=True, prompt=None, prompt_file=str(env_example))
        with self.assertRaises(ga.AssetGeneratorError):
            ga.build_generation_plan(args)

    def test_normal_prompt_file_still_works(self):
        prompt_file = self.prompts_dir / "ok.txt"
        prompt_file.write_text("A normal, safe prompt.", encoding="utf-8")
        args = make_args(dry_run=True, prompt=None, prompt_file=str(prompt_file))
        plan = ga.build_generation_plan(args)
        self.assertIn("A normal, safe prompt.", plan["final_prompt"])


class TestTargetSizeBounds(unittest.TestCase):
    def test_oversized_target_size_rejected(self):
        with self.assertRaises(ga.AssetGeneratorError):
            ga.parse_target_size("9999x9999")

    def test_within_bounds_target_size_accepted(self):
        self.assertEqual(ga.parse_target_size("2048x2048"), (2048, 2048))


class TestManifestFileCharacterSafety(IsolatedProjectTestCase):
    def test_validate_manifest_rejects_unsafe_file_characters(self):
        manifest = {
            "version": 1,
            "updated_at": None,
            "assets": [
                {
                    "id": "evil",
                    "category": "icons",
                    "file": 'assets/generated/icons/x.png"); } body { display:none; } /*',
                }
            ],
        }
        issues = ga.validate_manifest(manifest)
        self.assertTrue(any("unzulaessige Zeichen" in issue for issue in issues))

    def test_build_generated_css_skips_unsafe_file_entries(self):
        manifest = {
            "version": 1,
            "updated_at": None,
            "assets": [
                {"id": "safe-one", "category": "icons", "file": "assets/generated/icons/safe-one.png"},
                {
                    "id": "evil",
                    "category": "icons",
                    "file": 'assets/generated/icons/x.png"); } body { display:none; } /*',
                },
            ],
        }
        css_text = ga.build_generated_css(manifest)
        self.assertIn("--asset-safe-one", css_text)
        self.assertNotIn("display:none", css_text)
        self.assertNotIn("evil", css_text)


def _fake_openai_image_response(width: int = 32, height: int = 32):
    import base64
    import io

    from PIL import Image as PILImage

    buffer = io.BytesIO()
    PILImage.new("RGBA", (width, height), (10, 20, 30, 255)).save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    fake_item = mock.Mock()
    fake_item.b64_json = encoded
    fake_response = mock.Mock()
    fake_response.data = [fake_item]
    return fake_response


@unittest.skipUnless(
    ga.is_importable("openai") and ga.is_importable("PIL"),
    "openai/Pillow nicht installiert - dieser Test braucht beide (openai.OpenAI wird "
    "vollstaendig gemockt, es findet keine echte Netzwerkverbindung statt).",
)
class TestConcurrentManifestWrite(IsolatedProjectTestCase):
    def test_run_real_generation_does_not_lose_concurrently_added_entry(self):
        # Regression fuer den in der Sicherheitspruefung gefundenen "lost update":
        # zwei Auftraege bauen ihren Plan (inkl. Manifest-Momentaufnahme) BEVOR
        # irgendeiner von beiden schreibt - ein echtes "zwei Terminals gleichzeitig"-
        # Szenario. Ohne den Fix wuerde der zuletzt schreibende Lauf den zuerst
        # geschriebenen Eintrag stillschweigend wieder loeschen.
        os.environ["OPENAI_API_KEY"] = "test-fake-key-do-not-use"

        args_a = make_args(id="asset-a", dry_run=False, generate=True, confirm_api_call=True)
        args_b = make_args(id="asset-b", dry_run=False, generate=True, confirm_api_call=True)
        plan_a = ga.build_generation_plan(args_a)
        plan_b = ga.build_generation_plan(args_b)  # sieht noch dasselbe leere Manifest wie plan_a

        with mock.patch("openai.OpenAI") as mock_openai_cls:
            mock_openai_cls.return_value.images.generate.return_value = _fake_openai_image_response()
            ga.run_real_generation(plan_b)  # "schneller" Prozess schreibt zuerst
            ga.run_real_generation(plan_a)  # schreibt mit einem laengst veralteten plan["manifest"]

        final_manifest = ga.load_manifest()
        ids = {entry["id"] for entry in final_manifest["assets"]}
        self.assertEqual(ids, {"asset-a", "asset-b"})


if __name__ == "__main__":
    unittest.main()
