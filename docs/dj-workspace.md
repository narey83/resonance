# DJ workspace

Updated **21 October 2026**. Features, controls and configuration can change. See the
[feature inventory](../FEATURES.md) for the current scope and experimental areas.

## Library and preparation

The web application is designed for desktop screens. Main and library navigation
rails expand on hover or keyboard focus. **Auto size** chooses a compact interface
scale for the current window; **100%** restores normal size. Manual presets run from
50% to 100%. Interface scale does not change waveform detail or the audio.

Configure the shared library locations during setup or in System settings. Library
scans include their subfolders. New files from Soulseek, yt-dlp and copied folders
must be indexed before they can be prepared. Library → Preparation shows pending,
active, failed and completed work, with pause and retry controls. See
[automatic preparation](auto-analysis.md) for scheduling and tag-writing behaviour.

Browse, Prepare and Export table layouts retain their column settings. DJ and saved
filters narrow the collection; a track can be inspected before playback, and selection
actions prepare tracks, add them to a mixtape or start an export. Smart crates save
rules for tempo, harmonic key, genre, vocals, energy, folders and listening history;
their results update with the library. Existing metadata enrichment remains available
through the library and Tag Manager.

Mixtapes support ordering, artwork, public token links and M3U/ZIP downloads. Deleting
a mixtape requires confirmation and leaves the original audio files in the library.

## Set planning and transition preview

The workspace includes saved set plans, genre compatibility warnings,
ending-to-opening transition previews and full-set rehearsal.
A set uses one fixed master tempo, defaulting to its first track. Unsupported tempo
or timing combinations stop with an explanation; the engine does not silently change
the set master. A manually chosen master tempo also stays fixed for the set.

The compatibility view compares key, tempo, energy, genre evidence and candidate
phrase handovers. Synced preview auditions the end of track one against the beginning
of track two, with pitch-preserving tempo adjustment and a crossfader where timing
supports it. Full-set rehearsal walks through consecutive handovers; it does not
export a recorded mix.

Genre warnings distinguish cross-genre transitions, missing information and conflicts
between tags and predictions. The genre guide describes source-reviewed style
relationships, not verified individual mixes. Matching BPM alone does not establish
a suitable groove or arrangement.

## Player controls

The docked player and separate player window use one audio stream and current-track
state. Open the separate window with the player-window button; docked artwork does
not open another player view. BPM, key and LUFS appear with the track information.
The queue starts closed and opens explicitly.

The waveform can be shown or hidden, resized, and set to **Normal, 16×, 32×, 64×,
128× or 256× detail**. Normal shows the whole track; detail follows the playhead.
Beat grid and Vocals toggle their overlays. Choose **DJ phrases**, **Musical phrases**
or **Hide phrases** independently. Phrase colours identify section types; singing
and processed-voice regions are distinct predictions. Overlays require the relevant
saved analysis. See [beatgrid verification](beatgrid-verification.md).

Daylight, AMOLED, Midnight, Ultraviolet and Ember themes apply to the workspace and
player window. Waveform colours follow the active theme.

Audio processing starts **bypassed**. The master processing switch bypasses effects
and loudness normalization while leaving player volume available. When enabled,
controls use subtle ranges until **Unlock advanced controls** is selected. Returning
to subtle controls resets values outside that mode's limits. Processing changes
playback, not the source audio file or its analysis.

## Independent enhanced analysis

The server invokes `tools/analysis-worker/analyze_track.py` in a separately configured
Python environment. Model weights, music, runtime caches and local credentials are
not part of the source repository. Inference does not download models.

Copy `tools/analysis-worker/config.example.json` to private runtime configuration and
replace its example absolute paths with installed executables, model assets and the
worker source directory. The example retains the tested engine/profile choices;
it is not usable until the selected assets have been installed. Use dedicated Python
environments for BeatThis/CLAP/singing, Madmom DBN, Essentia, and Demucs/semantic phrases
where their dependency requirements differ. The worker currently uses POSIX process
groups for cancellation; Windows worker execution needs separate validation.

The deployed Docker runtime is built with `docker/analysis-worker.Dockerfile`, extending
`resonance-backend-dev:bridge-worker`. It runs inside the existing backend service.
Model assets are installed explicitly with:

```sh
python3 docker/scripts/install-analysis-models.py
```

`tools/analysis-worker/models.lock.json` pins every downloaded asset by SHA-256 and
byte length. The installer checks cached assets too and publishes downloads only
after verification. Assets stay under `backend/data/analysis-models`; the private
runtime configuration is `backend/data/analysis-config.json`. Neither music nor
model weights belong in the image build context. Build the analysis image with `python3 docker/scripts/build-analysis-worker.py`
after building its export/base image. The helper includes worker source and the
mount guard while excluding runtime data and credentials. The image records installed dependency versions and retains
the compiler only in its build stage. Model licenses are retained alongside the
worker sources. The checked-in singing provenance supplies the detector
configuration and pins its checkpoint.

Enable the startup variables below only after checking all configured engines and
local models inside the built image. Keep bulk preparation paused during a bounded
sample run; configuring the runtime otherwise makes the existing library eligible
for the automatic enhanced-analysis queue. Full-track results must still pass
`ExportAnalysisContract`; no unavailable feature is treated as successful analysis.

The 27 October deployment audit retains one finding in PyTorch 2.11.0:
`PYSEC-2025-194` (`torch.jit.script`, fixed upstream in 2.13.0). The paired
Torchaudio runtime is 2.11.0. Worker entry points do not accept model/code uploads
or call `torch.jit.script`; the Silero TorchScript file is loaded only after its
pinned SHA-256 is verified. This constrains the current inference input path; it
does not make the dependency audit clean. Recheck compatible tensor/audio versions
when updating. The DBN environment has no reported PyPI advisories; its Madmom
source commit is pinned separately because the development build has no PyPI
release to audit. Private audit reports are retained under `.dev/`.

Relevant engines/dependencies include `beat_this`, PyTorch/torchaudio, Transformers,
NumPy/SciPy, Essentia, Demucs, Madmom, and the included All-In-One and singing model
adapters. Install compatible dependencies for each environment and retain the model
licenses and checkpoint hashes. Notices are in `tools/analysis-worker/licenses/` and
the optional adapter directories. Missing engines remain visible as gaps.

Configure these startup environment variables, using absolute paths:

```sh
export RESONANCE_CANDIDATE_PYTHON=/opt/resonance/venvs/beats/bin/python
export RESONANCE_CANDIDATE_WORKER=/opt/resonance/tools/analysis-worker/analyze_track.py
export RESONANCE_CANDIDATE_CONFIG=/var/lib/resonance/analysis-config.json
export RESONANCE_CANDIDATE_OUTPUT_ROOT=/var/lib/resonance/candidates
export RESONANCE_CANDIDATE_TIMEOUT_SECONDS=660
```

Enhanced jobs automatically divide the processors available to the backend container
between concurrent tracks, bounded by a 5 GiB per-job memory estimate. The allocation
uses the container-aware .NET processor and memory limits, then passes each job's share
to PyTorch, OpenMP, MKL, OpenBLAS and NumExpr. Most installations should leave it in
automatic mode. Operators with measured hardware-specific requirements can override it
with `RESONANCE_CANDIDATE_WORKERS`, `RESONANCE_CANDIDATE_THREADS_PER_WORKER` and
`RESONANCE_CANDIDATE_MEMORY_PER_WORKER_MB`; zero workers/threads means automatic.

The analysis queue then uses the configured worker. Basic analysis still uses its
own ffmpeg/Essentia settings; enhanced setup does not replace those settings. See
[automatic preparation](auto-analysis.md). Rekordbox import is an optional migration
path for existing saved analysis, not an inference dependency.

## Experimental USB export and Network Link

The Export wizard prepares tracks, playlists, waveforms and beatgrids in a ZIP. It can
also be opened from library selections or a set plan. Folder selection chooses tracks
without imposing the source folder layout on the USB. The
server uses the Python writer in `tools/usb-export/`; install its `requirements.txt`
in a dedicated environment and keep its empty schema templates beside the scripts.

```sh
export RESONANCE_USB_EXPORT_ROOT=/var/lib/resonance/usb-exports
export RESONANCE_USB_EXPORT_PYTHON=/opt/resonance/venvs/usb-export/bin/python
export RESONANCE_USB_EXPORT_WORKER=/opt/resonance/tools/usb-export/usb_export.py
export RESONANCE_USB_EXPORT_FFMPEG=/usr/bin/ffmpeg
```

`desktop/bridge/` contains Resonance Bridge with USB Export and Network Link, native launcher,
installer builders, protocol sources and licenses. Build/install instructions are in
its [README](../desktop/bridge/README.md). Both actions use `.resonance` files.
Network Link serves the prepared whole library, checks for changes every 15 seconds
and refreshes as its revision changes. Tracks need indexing and complete enhanced
analysis before becoming available; there is no manual track picker.
It runs on the players' local network; the main Resonance server may be elsewhere.

USB export writes both classic and OneLibrary database formats when the dual profile
is selected. File-format readback and isolated-folder transfer checks have passed.
Physical USB/player acceptance remains outstanding, including OPUS-QUAD and legacy
models. Do not interpret source availability as a guarantee for every DJ device.
Helper binaries/installers also require native platform validation and signing before
general distribution. The helper refuses overwriting existing exports and never
formats drives.

## Validation

Run these from the repository root (the commands change directories as shown):

```sh
cd frontend
npm ci
npm run lint
npm run test-unattended -- --runInBand
npm run build
node scripts/test-mix-dsp.mjs
cd ..
dotnet test tests/Resonance.Tests.csproj
cd desktop/bridge
go test ./...
```

Python unit tests live beside their worker/export source. They can run without model
inference where only signal-processing policies or format generation are exercised.
PostgreSQL tests require dedicated disposable databases named by their test guards.
The database migration CLI is documented in [database architecture](database/architecture.md).

The 15-track fixtures provide regression coverage for timing and workspace behaviour;
they do not establish universal genre, phrase or vocal accuracy. Models, browsers,
operating systems and physical players need their own acceptance checks.
