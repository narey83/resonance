# Native Resonance with enhanced analysis

The Linux x86_64 app release includes an enhanced-analysis bundle. Build it on the
release host from verified Python environments, worker source, model assets and
the pinned model lockfile. `enhanced-bundle.py build` checks each model SHA-256 and
copies Python runtimes, dependencies, the worker, FFmpeg and models into one
directory. Include that directory and both scripts in `ops/native` in the app
release. This build step is for release maintainers; app installation does not
fetch Python packages or models.

Example bundle build (paths are installed inputs on the release builder):

```sh
python3 ops/native/enhanced-bundle.py build \
  --output RELEASE/enhanced-analysis \
  --enhanced ENHANCED_VENV --dbn DBN_VENV --key KEY_VENV \
  --python312 PYTHON_3_12_DISTRIBUTION \
  --python314 PYTHON_3_14_DISTRIBUTION \
  --models VERIFIED_MODELS --worker tools/analysis-worker \
  --config PRIVATE_WORKER_CONFIG
```

The two Python distributions must each contain `bin/python3.12` or
`bin/python3.14`. The installer relocates the three environments and checks
that PyTorch, Madmom and Essentia import from the installed copy. Bundle
production currently targets Linux x86_64; other platforms need their own
verified Python wheels and model runtime.

Use a CUDA-capable PyTorch build in `ENHANCED_VENV` to enable GPU stem analysis on
compatible NVIDIA hardware. The worker detects CUDA at run time, serializes
GPU inference between tracks and retries on CPU if CUDA is unavailable or fails.
A CPU-only PyTorch build remains valid and takes the CPU path automatically.

Install the release with:

```sh
python3 ops/native/install-backend-service.py \
  --release-root RELEASE_ROOT --app-dir APP_DIR --working-dir WORKING_DIR \
  --activate
```

The installer copies the bundle into app data, rewrites its internal paths,
verifies its Python engines, and enables the backend user service. No enhanced
analysis environment variables or separate worker service are needed. The app
discovers the installed bundle on every start. The user service restarts after
crashes and starts after reboot when user lingering is enabled. Installation
preserves prior bundles and selects the new one atomically.

For an already running native app, pass `--inherit-pid PID` and omit
`--activate`. Drain any active scan before stopping that process and starting
`resonance-backend.service`; never run two backends against one app directory.
Keep the automatic preparation queue in its previous paused/running state.
