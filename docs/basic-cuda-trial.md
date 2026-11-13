# Basic CUDA trial — 13 November 2026

We profiled Basic analysis and ran two isolated CUDA experiments on the dev laptop's
Quadro M1000M (2 GiB, compute capability 5.0). The input was the 317.6-second
“Schelle” MP3. Runs used one low-priority process at a time and did not change
Resonance's analysis environment, library, jobs, queues, or running services.

| Work | Measured wall time | Result |
| --- | ---: | --- |
| Basic FFmpeg decode and loudness | 2.14 s | Full 44.1 kHz mono PCM and EBU R128 |
| Basic C# four-band waveform | 0.111 s | Actual `AudioAnalyzer.ComputeBands` |
| Basic Essentia process | 6.99 s | Import, key, rhythm, and beat loudness |
| Essentia rhythm detector alone | 5.713 s | 738 beats; first beat at 0.453 s |
| CUDA waveform peak reduction | 27.8 ms warm; 285 ms first call | Exact output, but slower than the 15.1 ms NumPy CPU reduction |
| CUDA BeatThis alternative | 11.46 s process wall | 714 beats; first beat at 0.040 s |

The waveform CUDA trial used PyTorch 2.11 with CUDA 12.6, the same 200 Hz bucket
bounds as Basic, host-to-device and device-to-host transfers, and synchronization.
Its result was bit identical to the CPU reference, but warm runs were about 1.8
times slower. The entire Basic waveform stage is only about 1% of the measured
decode, waveform, and Essentia wall time, so porting its peak reduction offers
little end-to-end benefit.

Essentia's `RhythmExtractor2013(multifeature)` is the measured hotspot. Its
[documented API](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)
has no CUDA device option. A GPU path therefore needs a replacement beat
algorithm, with separate accuracy validation. The isolated BeatThis CUDA trial
used an existing verified checkpoint and required 6.38 seconds for inference;
its 11.46-second process wall exceeded the roughly 9.24 seconds of measured
Basic stages. These were single-track trials under an active development
workload, not controlled library-throughput benchmarks.

BeatThis's first 64 beats were within 50 ms of Basic's recovered opening grid.
From about 55 seconds onward, the grids often differed by roughly 0.2 seconds.
Cached low-band attacks in several later sections were stronger near BeatThis's
beats, so the disagreement may reveal a Basic phase slip. Low-band attacks alone
do not establish the musical bar phase. BeatThis also stopped finding beats at
305.24 seconds and its minimal postprocessor produced too many downbeats for a
dependable four-beat bar grid. Neither speed nor accuracy evidence supports
replacing Basic with this GPU result.

Basic remains on its CPU path. A future timing improvement should first target
the full-track rhythm stage, compare complete library throughput, and validate
beat and phrase phase against actual audio. Trial scripts and machine-readable
results are retained on `dev-laptop.local` under
`/home/narey/resonance-builds/cuda-basic-20261113/` and
`/home/narey/resonance-builds/beatthis-basic-trial-20261113/`.
