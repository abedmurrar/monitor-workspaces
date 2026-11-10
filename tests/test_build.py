import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("extension_build", ROOT / "scripts" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def test_archive_is_reproducible_and_contains_only_runtime_files(self):
        with tempfile.TemporaryDirectory() as directory:
            first = builder.build(Path(directory) / "first.zip")
            second = builder.build(Path(directory) / "second.zip")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(set(archive.namelist()), set(builder.RUNTIME_FILES) | {
                    "schemas/gschemas.compiled", "LICENSE",
                })
                self.assertEqual(json.loads(archive.read("metadata.json"))["version"],
                                 json.loads((ROOT / "src" / "metadata.json").read_text())["version"])
                self.assertGreater(len(archive.read("schemas/gschemas.compiled")), 0)
                self.assertIsNone(archive.testzip())

    def test_every_source_module_ships(self):
        modules = {path.name for path in (ROOT / "src").glob("*.js")}
        self.assertEqual(modules - set(builder.RUNTIME_FILES), set(),
                         "A module missing from RUNTIME_FILES only fails inside GNOME Shell")


if __name__ == "__main__":
    unittest.main()
