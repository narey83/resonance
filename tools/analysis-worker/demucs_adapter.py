"""Explicit local HTDemucs inference; CUDA when available, CPU otherwise."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import torch
from demucs.apply import apply_model

from demucs_checkpoint import load_verified_model
from gpu_runtime import lock_path_for_model, run_with_gpu_fallback
from runtime_resources import configure_torch


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('--output', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--model-root', required=True)
    parser.add_argument('--seconds', type=float)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    root = Path(args.model_root)
    weight = root / '955717e8-8726e21a.th'
    assert sha(weight) == '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
    threads = configure_torch(torch)
    torch.manual_seed(0)
    np.random.seed(0)
    command = [args.ffmpeg, '-v', 'error', '-i', args.audio]
    if args.seconds:
        command += ['-t', str(args.seconds)]
    command += ['-ac', '2', '-ar', '44100', '-f', 'f32le', '-']
    audio = np.frombuffer(subprocess.check_output(command), dtype='<f4').reshape(-1, 2).copy()
    wave = torch.from_numpy(audio.T)
    reference = wave.mean(dim=0)
    mean = reference.mean()
    standard_deviation = reference.std()
    assert standard_deviation > 1e-8
    start = time.time()

    def infer(device):
        model = load_verified_model(root).eval()
        with torch.inference_mode():
            stems = apply_model(model, ((wave - mean) / standard_deviation)[None],
                                device=device, shifts=1, split=True, overlap=.25, progress=False)[0]
        return stems * standard_deviation + mean, model.sources

    (stems, sources), device, gpu_attempted, gpu_fallback, gpu_peak = run_with_gpu_fallback(
        torch, infer, lock_path_for_model(root))
    rows = {}
    for name, stem in zip(sources, stems):
        values = stem.cpu().numpy().T.astype('<f4')
        assert values.shape == audio.shape and np.isfinite(values).all()
        destination = output / (name + '.wav')
        subprocess.run([args.ffmpeg, '-v', 'error', '-f', 'f32le', '-ar', '44100', '-ac', '2',
                        '-i', '-', '-c:a', 'pcm_f32le', str(destination)],
                       input=values.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        rows[name] = {'sha256': sha(destination), 'frames': len(values),
                      'peak': float(np.max(np.abs(values)))}
    manifest = {
        'engine': 'htdemucs', 'checkpointSha256': sha(weight), 'audioSha256': sha(args.audio),
        'sampleRate': 44100, 'channels': 2, 'durationSeconds': len(audio) / 44100,
        'stems': rows, 'seed': 0, 'shifts': 1, 'overlap': .25, 'device': device,
        'gpuAttempted': gpu_attempted, 'gpuFallback': gpu_fallback,
        'gpuPeakAllocatedBytes': gpu_peak, 'threads': threads,
        'elapsedSeconds': time.time() - start,
        'floatWavWithoutIndependentStemRescaling': True,
        'mixtureRelativeL2Residual': float(torch.linalg.vector_norm(stems.sum(dim=0) - wave)
                                          / torch.linalg.vector_norm(wave)),
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main()
