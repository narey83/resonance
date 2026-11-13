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
        self.assertTrue(self.functions['prefer_attack_grid'](original, candidate, bass))
        self.assertFalse(self.functions['prefer_attack_grid'](candidate, original, bass))
        self.assertFalse(self.functions['prefer_attack_grid'](candidate, candidate, bass))

    def test_clickless_low_end_attack_can_select_a_grid(self):
        rate = 44100
        duration = 25
        audio = np.zeros(duration * rate, dtype=np.float32)
        time = np.arange(int(.24 * rate)) / rate
        phase = 2*np.pi*(50*time + 90*.035*(1-np.exp(-time/.035)))
        envelope = (1-np.exp(-time/.006))*np.exp(-time/.09)
        kick = (.8 * envelope * np.sin(phase)).astype(np.float32)
        for onset in np.arange(rate//2, len(audio)-len(kick), 18900):
            audio[onset:onset+len(kick)] = kick
        candidate = np.arange(.5, duration-.2, 60/140) + .01
        original = candidate - 30/140
        bass = self.functions['attack_strength'](audio, 35, 180)
        self.assertGreater(self.functions['attack_support'](candidate, bass), .9)
        self.assertLess(self.functions['attack_support'](original, bass), .1)
        self.assertTrue(self.functions['prefer_attack_grid'](original, candidate, bass))
        aligned = self.functions['align_bass_onsets'](candidate, bass)
        errors = np.abs((aligned - .5 + 30/140) % (60/140) - 30/140)
        self.assertLess(float(np.quantile(errors, .95)), .005)

    def test_bass_alignment_does_not_extrapolate_silent_beats(self):
        beats = np.arange(.5, 24, .5)
        bass = np.zeros(5000)
        np.testing.assert_array_equal(self.functions['align_bass_onsets'](beats, bass), beats)

    def test_silence_and_changed_tempo_do_not_replace_grid(self):
        beats = np.arange(.2, 24, .5)
        silent = np.zeros(5000)
        choose = self.functions['prefer_attack_grid']
        self.assertFalse(choose(beats, beats+.1, silent))
        strong = np.ones(5000)
        self.assertFalse(choose(beats, beats[::2], strong))
        self.assertFalse(choose(beats, beats+4, strong))
        self.assertFalse(choose(beats, np.r_[beats[:-1], np.nan], strong))
        self.assertFalse(choose(beats[:10], beats[:10], strong))


if __name__ == '__main__':
    unittest.main()
