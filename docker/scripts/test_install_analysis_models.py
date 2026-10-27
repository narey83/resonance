"""Integrity checks for deployment-time model acquisition; no network access."""

import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "models", Path(__file__).with_name("install-analysis-models.py")
)
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


class ModelAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.destination = Path(self.temp.name)
        self.override = patch.object(models, "DEST", self.destination)
        self.override.start()
        self.addCleanup(self.override.stop)
        self.payload = b"verified checkpoint fixture"
        self.row = {
            "file": "engine/model.bin",
            "url": "https://example.invalid/model",
            "bytes": len(self.payload),
            "sha256": hashlib.sha256(self.payload).hexdigest(),
        }

    def test_publishes_only_verified_download(self):
        with patch.object(
            models.urllib.request, "urlopen", return_value=io.BytesIO(self.payload)
        ):
            models.fetch(self.row)
        self.assertEqual(
            (self.destination / self.row["file"]).read_bytes(), self.payload
        )
        self.assertFalse((self.destination / "engine/model.bin.part").exists())

    def test_corrupt_download_is_not_published(self):
        with (
            patch.object(
                models.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt")
            ),
            self.assertRaises(ValueError),
        ):
            models.fetch(self.row)
        self.assertFalse((self.destination / self.row["file"]).exists())

    def test_cached_file_is_verified_without_network(self):
        path = self.destination / self.row["file"]
        path.parent.mkdir()
        path.write_bytes(self.payload)
        with patch.object(
            models.urllib.request, "urlopen", side_effect=AssertionError("No network")
        ):
            models.fetch(self.row)
        path.write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            models.fetch(self.row)

    def test_path_traversal_is_rejected(self):
        for path in ("../outside", "/outside"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                models.fetch(dict(self.row, file=path))


if __name__ == "__main__":
    unittest.main()
