"""Regression for the exact detector script shipped by AudioAnalyzer."""
import json
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest

import numpy as np


class FullTrackBeatTests(unittest.TestCase):
    def test_beats_cover_full_pcm_and_follow_known_transients(self):
        source = (Path(__file__).resolve().parents[2] /
                  'backend/Analysis/AudioAnalyzer.cs').read_text()
        script = textwrap.dedent(source.split('private const string EssentiaScript = """', 1)[1]
                                 .split('""";', 1)[0])
        rate = 44100
        time = np.arange(150 * rate, dtype=np.float32) / rate
        phase = np.maximum(time - .2, 0) % .5
        audio = (.8 * np.exp(-phase * 50) * np.sin(2 * np.pi * 70 * phase))
        audio[time < .2] = 0
        result = subprocess.run(
            [sys.executable, '-c', script, 'edma', 'multifeature', '120', 'bpm,key'],
            input=audio.astype('<f4').tobytes(), capture_output=True, check=True,
            timeout=120)
        data = json.loads(next(line.split('RESONANCE_JSON:', 1)[1]
                               for line in result.stdout.decode().splitlines()
                               if line.startswith('RESONANCE_JSON:')))
        beats = np.asarray(data['beats'])
        self.assertGreater(beats[-1], 148, 'Beat timestamps stopped at the sample window')
        self.assertGreater(len(beats), 280)
        self.assertLess(abs(data['bpm'] - 120), 2)
        # Compare to the known kick times, including the region after the old cutoff.
        for region in (beats[(beats > 5) & (beats < 115)], beats[beats > 125]):
            errors = np.abs((region - .2 + .25) % .5 - .25)
            self.assertLess(float(np.quantile(errors, .95)), .065)
        self.assertTrue(data['key'])


if __name__ == '__main__':
    unittest.main()
