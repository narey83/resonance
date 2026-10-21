# DJ workspace and optional workers

The desktop web workspace includes smart crates, preparation status, saved set plans,
genre compatibility warnings, ending-to-opening transition previews and set rehearsal.
A set uses one fixed master tempo, defaulting to its first track. Unsupported tempo
or timing combinations stop with an explanation; the engine does not silently change
the set master. Interface scale supports compact layouts up to normal size (100%).

The docked player and separate player window share one audio stream, waveform detail,
beatgrid, phrase/vocal overlays and metadata. Processing can be bypassed completely;
subtle settings are the default, with explicit advanced controls. Mixtape deletion
requires confirmation and leaves original music files in the library.

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

The normal analysis queue then uses the configured worker. See
[automatic preparation](auto-analysis.md). Rekordbox import is an optional migration
path for existing saved analysis, not an inference dependency.

## Experimental USB export and Network Link

The Export wizard prepares tracks, playlists, waveforms and beatgrids in a ZIP. Folder
selection chooses tracks without imposing the source folder layout on the USB. The
server uses the Python writer in `tools/usb-export/`; install its `requirements.txt`
in a dedicated environment and keep its empty schema templates beside the scripts.

```sh
export RESONANCE_USB_EXPORT_ROOT=/var/lib/resonance/usb-exports
export RESONANCE_USB_EXPORT_PYTHON=/opt/resonance/venvs/usb-export/bin/python
export RESONANCE_USB_EXPORT_WORKER=/opt/resonance/tools/usb-export/usb_export.py
export RESONANCE_USB_EXPORT_FFMPEG=/usr/bin/ffmpeg
```

`desktop/pioneer-link/` contains the shared USB and Network Link helper, native launcher,
installer builders, protocol sources and licenses. Build/install instructions are in
its [README](../desktop/pioneer-link/README.md). Both actions use `.resonance` files.
Network Link serves the prepared whole library and refreshes as its revision changes.
It runs on the players' local network; the main Resonance server may be elsewhere.

USB export writes both classic and OneLibrary database formats when the dual profile
is selected. File-format readback and isolated-folder transfer checks have passed.
Physical USB/player acceptance remains outstanding, including OPUS-QUAD and legacy
models. Do not interpret source availability as a guarantee for every Pioneer device.
Helper binaries/installers also require native platform validation and signing before
general distribution. The helper refuses overwriting existing exports and never
formats drives.

## Validation

```sh
cd frontend
npm ci
npm run lint
npm run test-unattended -- --runInBand
npm run build
node scripts/test-mix-dsp.mjs
cd ..
dotnet test tests/Resonance.Tests.csproj
cd desktop/pioneer-link
go test ./...
```

Python unit tests live beside their worker/export source. They can run without model
inference where only signal-processing policies or format generation are exercised.
PostgreSQL tests require dedicated disposable databases named by their test guards.
The database migration CLI is documented in [database architecture](database/architecture.md).
