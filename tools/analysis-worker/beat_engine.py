"""Independent BeatThis adapter. Requires beat-this; no Rekordbox files or code.

Use an explicitly acquired BeatThis checkpoint. No implicit network/cache writes.
Frame logits and their sigmoid transforms are model scores, not confidence.
BPM values describe inferred timestamps; they are not constrained to any DJ range.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import numpy as np
from runtime_resources import analysis_threads

class BeatEngine:
    def __init__(self, checkpoint: str | Path, threads: int | None = None):
        import torch
        from beat_this.inference import Audio2Frames
        from beat_this.model.postprocessor import Postprocessor
        threads = threads or analysis_threads()
        self.checkpoint = Path(checkpoint).resolve(strict=True)
        self.sha256 = hashlib.sha256(self.checkpoint.read_bytes()).hexdigest()
        torch.set_num_threads(threads)
        self.model = Audio2Frames(str(self.checkpoint), device='cpu', float16=False)
        self.postprocess = Postprocessor(type='minimal')
        self.threads = threads

    def analyze(self, mono: np.ndarray, sample_rate: int, include_frame_scores=False) -> dict:
        import torch
        audio = np.asarray(mono, dtype=np.float32)
        if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
            raise ValueError('Expected nonempty finite mono PCM array')
        if sample_rate <= 0:
            raise ValueError('Sample rate must be positive')
        with torch.inference_mode():
            beat_logits, downbeat_logits = self.model(audio, sample_rate)
            beats, downbeats = self.postprocess(beat_logits, downbeat_logits)
        beats = np.asarray(beats, dtype=float)
        intervals = np.diff(beats)
        # Quantized model frames can bias median single-interval BPM. Preserve
        # both local median and whole-span estimates rather than round/fold.
        positive = intervals[intervals > 0]
        result = {
            'engine': 'beat-this', 'engine_version': importlib.metadata.version('beat-this'),
            'checkpoint_sha256': self.sha256, 'device': 'cpu', 'threads': self.threads,
            'postprocessor': 'minimal', 'dbn': False,
            'duration_seconds': len(audio) / sample_rate,
            'beats_seconds': beats.tolist(),
            'downbeats_seconds': np.asarray(downbeats, dtype=float).tolist(),
            'bpm_median_interval': float(60 / np.median(positive)) if len(positive) else None,
            'bpm_whole_span': float(60 * (len(beats)-1) / (beats[-1]-beats[0])) if len(beats)>1 else None,
            'confidence': None,
            'score_semantics': 'Uncalibrated model logits. No probability of correct timing or calibrated track confidence.',
            'timing_resolution_seconds': 0.02,
        }
        from tempo_summary import summarize_tempo
        result.update(summarize_tempo(beats))
        if include_frame_scores:
            result['frame_scores'] = {
                'frames_per_second': 50,
                'beat_logits': beat_logits.detach().cpu().numpy().tolist(),
                'downbeat_logits': downbeat_logits.detach().cpu().numpy().tolist(),
            }
        return result

def decode_audio(path: Path, ffmpeg: Path, seconds: float | None = None):
    cmd = [str(ffmpeg), '-v', 'error', '-i', str(path)]
    if seconds is not None:
        if seconds <= 0: raise ValueError('Duration limit must be positive')
        cmd += ['-t', str(seconds)]
    cmd += ['-ar', '22050', '-ac', '2', '-f', 'f32le', '-']
    pcm = subprocess.check_output(cmd)
    return np.frombuffer(pcm, dtype='<f4').reshape(-1, 2).mean(axis=1), 22050

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=float)
    parser.add_argument('--include-frame-scores', action='store_true')
    args = parser.parse_args()
    audio, sr = decode_audio(args.audio, args.ffmpeg, args.seconds)
    result = BeatEngine(args.checkpoint).analyze(audio, sr, args.include_frame_scores)
    result['audio_sha256'] = hashlib.sha256(args.audio.read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, indent=2))

if __name__ == '__main__': main()
