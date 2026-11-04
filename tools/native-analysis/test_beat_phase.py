"""Exercise the exact shipped phase-selection code with known audio attacks."""
from pathlib import Path
import textwrap
import unittest

import numpy as np


class BeatPhaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (Path(__file__).resolve().parents[2] /
                  'backend/Analysis/AudioAnalyzer.cs').read_text()
        script = textwrap.dedent(source.split('private const string EssentiaScript = """', 1)[1]
                                 .split('""";', 1)[0])
        cls.functions = {}
        exec(script.split('SHARP =', 1)[0], cls.functions)

    def test_measured_attacks_win_over_half_beat_phase(self):
        rate = 44100
        time = np.arange(25 * rate, dtype=np.float32) / rate
        period = 60 / 136
        phase = np.maximum(time - .2, 0) % period
        audio = (.8 * np.exp(-phase * 45) * np.sin(2*np.pi*70*phase) +
                 .2 * np.exp(-phase * 300) * np.sin(2*np.pi*1200*phase))
        audio[time < .2] = 0
        candidate = np.arange(.2, 24, period) + .005
        original = candidate + period/2
        bass = self.functions['attack_strength'](audio, 35, 180)
        attack = self.functions['attack_strength'](audio, 300, 2000)
        self.assertTrue(self.functions['prefer_attack_grid'](original, candidate, bass, attack))
        self.assertFalse(self.functions['prefer_attack_grid'](candidate, original, bass, attack))
        self.assertFalse(self.functions['prefer_attack_grid'](candidate, candidate, bass, attack))

    def test_silence_and_changed_tempo_do_not_replace_grid(self):
        beats = np.arange(.2, 24, .5)
        silent = np.zeros(5000)
        choose = self.functions['prefer_attack_grid']
        self.assertFalse(choose(beats, beats+.1, silent, silent))
        strong = np.ones(5000)
        self.assertFalse(choose(beats, beats[::2], strong, strong))
        self.assertFalse(choose(beats, beats+4, strong, strong))
        self.assertFalse(choose(beats, np.r_[beats[:-1], np.nan], strong, strong))
        self.assertFalse(choose(beats[:10], beats[:10], strong, strong))


if __name__ == '__main__':
    unittest.main()
