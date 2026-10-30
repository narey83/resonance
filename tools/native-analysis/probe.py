"""Exercise the real basic-analysis detectors, without reading or changing music."""
import importlib.metadata
import json

import essentia.standard as es
import numpy as np


def probe():
    rate = 44100
    time = np.arange(30 * rate, dtype=np.float32) / rate
    # A major triad with a kick every half second. This checks engine availability,
    # not musical accuracy on real tracks.
    audio = sum(0.1 * np.sin(2 * np.pi * frequency * time)
                for frequency in (220, 277.1826, 329.6276))
    beat_time = time % 0.5
    audio += 0.7 * np.exp(-beat_time * 50) * np.sin(2 * np.pi * 70 * beat_time)
    audio = audio.astype(np.float32)
    bpm, ticks, _, _, _ = es.RhythmExtractor2013(method='multifeature')(audio)
    key, scale, _ = es.KeyExtractor(profileType='edma')(audio)
    return {
        'bpm': float(bpm), 'key': key, 'scale': scale, 'beats': len(ticks),
        'packages': {name: importlib.metadata.version(name)
                     for name in ('essentia', 'numpy', 'PyYAML', 'six')},
    }


if __name__ == '__main__':
    print('RESONANCE_NATIVE_ANALYSIS:' + json.dumps(probe()))
