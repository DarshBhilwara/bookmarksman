import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "build-extension.py"
SPEC = importlib.util.spec_from_file_location("build_extension", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuildExtensionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / "extension"
        source.mkdir()
        (source / "manifest.json").write_text(json.dumps({"browser": "chrome"}))
        (source / "manifest.firefox.json").write_text(json.dumps({
            "browser_specific_settings": {"gecko": {"id": "bookmarksman@local"}},
            "content_security_policy": {"extension_pages": "connect-src http: https:"},
        }))
        (source / "background.js").write_text("// background")
        (source / "tests").mkdir()
        (source / "tests" / "private.test.js").write_text("test")
        (source / "__pycache__").mkdir()
        (source / "__pycache__" / "module.pyc").write_bytes(b"bytecode")
        self.original = builder.ROOT, builder.SOURCE, builder.DIST
        builder.ROOT = self.root
        builder.SOURCE = source
        builder.DIST = self.root / "dist"

    def tearDown(self):
        builder.ROOT, builder.SOURCE, builder.DIST = self.original
        self.temp.cleanup()

    def test_builds_stable_packages_without_tests_or_local_settings(self):
        chrome = builder.build("chrome", "manifest.json")
        firefox = builder.build_firefox_unsigned()
        stage = self.root / "dist" / "bookmarksman-chrome"
        self.assertTrue(stage.is_dir())
        self.assertEqual(chrome.name, "bookmarksman-chrome.zip")
        self.assertEqual(firefox.name, "bookmarksman-firefox-unsigned.xpi")
        for archive_path in (chrome, firefox):
            with zipfile.ZipFile(archive_path) as archive:
                names = archive.namelist()
                self.assertIn("manifest.json", names)
                self.assertFalse(any(name.startswith("tests/") or "__pycache__" in name for name in names))
                self.assertNotIn("manifest.firefox.json", names)
                self.assertFalse(any("storage" in name.lower() for name in names))
                manifest = json.loads(archive.read("manifest.json"))
                if archive_path == firefox:
                    self.assertEqual(manifest["browser_specific_settings"]["gecko"]["id"], "bookmarksman@local")
                    self.assertIn("http:", manifest["content_security_policy"]["extension_pages"])

    def test_rebuild_preserves_signed_xpi_and_unpacked_paths(self):
        builder.build("chrome", "manifest.json")
        builder.build_firefox_unsigned()
        signed = builder.DIST / "bookmarksman-firefox-signed.xpi"
        signed.write_bytes(b"signed package")
        chrome_stage = builder.DIST / "bookmarksman-chrome"
        firefox_stage = builder.DIST / "bookmarksman-firefox"
        builder.build("chrome", "manifest.json")
        builder.build_firefox_unsigned()
        self.assertEqual(signed.read_bytes(), b"signed package")
        self.assertTrue(chrome_stage.is_dir())
        self.assertTrue(firefox_stage.is_dir())


if __name__ == "__main__":
    unittest.main()
