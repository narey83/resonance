import unittest
import numpy as np
from tempo_summary import summarize_tempo


class TempoTests(unittest.TestCase):
    def test_quantized_128_bpm(self):
        beats = np.round(np.arange(600) * 60 / 128 / .02) * .02
        raw = 60 / np.median(np.diff(beats))
        result = summarize_tempo(beats)
        self.assertGreater(abs(raw - 128), 2)
        self.assertLess(abs(result['bpm_multi_interval'] - 128), .4)

    def test_tempo_change_is_retained(self):
        beats = np.r_[np.arange(100) * .65, 65 + np.arange(150) * .4]
        result = summarize_tempo(beats)
        values = [x['bpm'] for x in result['tempo_windows']]
        self.assertLess(min(values), 94)
        self.assertGreater(max(values), 149)
        self.assertGreater(result['tempo_variation_ratio'], 1.5)

    def test_short_and_invalid_grids(self):
        self.assertIsNone(summarize_tempo([])['bpm_multi_interval'])
        self.assertAlmostEqual(summarize_tempo([0, .5])['bpm_multi_interval'], 120)
        for beats in ([0, 0], [1, 0], [0, float('nan')]):
            with self.assertRaises(ValueError):
                summarize_tempo(beats)


if __name__ == '__main__':
    unittest.main()
