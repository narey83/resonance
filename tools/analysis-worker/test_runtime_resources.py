import os
import unittest
from unittest.mock import patch

import runtime_resources


class RuntimeResourceTests(unittest.TestCase):
    def test_defaults_to_available_affinity(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(runtime_resources, "available_processors", return_value=6):
            self.assertEqual(runtime_resources.analysis_threads(), 6)

    def test_parent_allocation_is_honoured_and_clamped(self):
        with patch.dict(os.environ, {"RESONANCE_ANALYSIS_THREADS": "3"}, clear=True), patch.object(runtime_resources, "available_processors", return_value=8):
            self.assertEqual(runtime_resources.analysis_threads(), 3)
        with patch.dict(os.environ, {"RESONANCE_ANALYSIS_THREADS": "20"}, clear=True), patch.object(runtime_resources, "available_processors", return_value=8):
            self.assertEqual(runtime_resources.analysis_threads(), 8)

    def test_invalid_parent_allocation_fails_closed(self):
        for value in ("0", "nope"):
            with self.subTest(value=value), patch.dict(os.environ, {"RESONANCE_ANALYSIS_THREADS": value}, clear=True):
                with self.assertRaises(ValueError):
                    runtime_resources.analysis_threads()

    def test_configures_intra_and_interop_threads(self):
        class Torch:
            intra = None
            inter = None

            @classmethod
            def set_num_threads(cls, value):
                cls.intra = value

            @classmethod
            def set_num_interop_threads(cls, value):
                cls.inter = value

        with patch.dict(os.environ, {"RESONANCE_ANALYSIS_THREADS": "5"}, clear=True), patch.object(runtime_resources, "available_processors", return_value=8):
            self.assertEqual(runtime_resources.configure_torch(Torch), 5)
        self.assertEqual(Torch.intra, 5)
        self.assertEqual(Torch.inter, 2)


if __name__ == "__main__":
    unittest.main()
