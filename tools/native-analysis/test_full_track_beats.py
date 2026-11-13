"""Regression for the exact detector script shipped by AudioAnalyzer."""
import json
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest

import numpy as np


class FullTrackBeatTests(unittest.TestCase):
    def test_clickless_kick_grid_uses_measured_phase(self):
        source = (Path(__file__).resolve().parents[2] /
                  'backend/Analysis/AudioAnalyzer.cs').read_text()
        script = textwrap.dedent(source.split('private const string EssentiaScript = """', 1)[1]
                                 .split('""";', 1)[0])
        rate = 44100
        duration = 45
        audio = np.zeros(duration * rate, dtype=np.float32)
        time = np.arange(int(.24 * rate)) / rate
        phase = 2*np.pi*(50*time + 90*.035*(1-np.exp(-time/.035)))
        envelope = (1-np.exp(-time/.006))*np.exp(-time/.09)
        kick = (.8 * envelope * np.sin(phase)).astype(np.float32)
        for onset in range(rate//2, len(audio)-len(kick), 18900):
            audio[onset:onset+len(kick)] = kick

        result = subprocess.run(
            [sys.executable, '-c', script, 'edma', 'multifeature', '45', 'bpm,key'],
            input=audio.tobytes(), capture_output=True, check=True, timeout=120)
        data = json.loads(next(line.split('RESONANCE_JSON:', 1)[1]
                               for line in result.stdout.decode().splitlines()
                               if line.startswith('RESONANCE_JSON:')))
        beats = np.asarray(data['beats'])
        errors = np.abs((beats - .5 + 30/140) % (60/140) - 30/140)
        self.assertLess(abs(data['bpm'] - 140), 2)
        self.assertGreater(len(beats), 100)
        self.assertLess(abs(beats[0] - .5), .04)
        self.assertGreater(beats[-1], 44)
        self.assertLess(float(np.quantile(errors, .95)), .008)

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
