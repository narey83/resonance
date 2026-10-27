"""Checkpoint integrity must be checked before any model deserialization."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import demucs_checkpoint as checkpoint
import torch


class DemucsCheckpointTests(unittest.TestCase):
    def test_corrupt_checkpoint_never_reaches_model_loader(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / checkpoint.CHECKPOINT).write_bytes(b"invalid")
            with patch.object(checkpoint, "get_model") as load:
                with self.assertRaisesRegex(ValueError, "identity mismatch"):
                    checkpoint.load_verified_model(directory)
                load.assert_not_called()

    def test_verified_load_scopes_safe_constructors(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = b"test checkpoint"
            (Path(directory) / checkpoint.CHECKPOINT).write_bytes(payload)
            before = torch.serialization.get_safe_globals()

            def load(name, repo):
                self.assertEqual(name, "955717e8")
                self.assertEqual(repo, Path(directory))
                self.assertIn(
                    checkpoint.HTDemucs, torch.serialization.get_safe_globals()
                )
                return "loaded"

            with (
                patch.object(checkpoint, "SHA256", hashlib.sha256(payload).hexdigest()),
                patch.object(checkpoint, "get_model", side_effect=load),
            ):
                self.assertEqual(checkpoint.load_verified_model(directory), "loaded")
            self.assertEqual(torch.serialization.get_safe_globals(), before)


if __name__ == "__main__":
    unittest.main()
