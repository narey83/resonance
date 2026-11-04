# Native basic analysis

Basic analysis requires **BPM, key, waveform and loudness**. FFmpeg can produce
waveform/loudness without Essentia; those two results alone do not establish that
the BPM/key engine is available. Native deployments must provision and check it.

This kit is copied into every backend build/publish at `tools/native-analysis/`.
It installs pinned, SHA-256-verified PyPI wheels into a persistent virtual
environment outside the application release. The included wheel lock targets
**Linux x86_64 and CPython 3.14**. Unsupported installs stop with an error;
there is no implicit global installation, source build or runtime download.

Run on the deployment host before declaring a native deployment ready:

```sh
python3 tools/native-analysis/provision.py --venv "$HOME/resonance-analysis/keyenv"
```

The check exercises both real detectors on synthetic audio and requires a valid
BPM, key and detected beats, plus the locked package versions. An import-only
check or a successful FFmpeg decode is insufficient. It does not scan music,
change tags or start a library queue.

On first setup, persist the path through an existing administrator session:

```sh
python3 tools/native-analysis/provision.py \
  --venv "$HOME/resonance-analysis/keyenv" --check --configure \
  --base-url http://127.0.0.1:55450 \
  --session-file /private/path/existing-session.json
```

The private session file contains `{"token":"existing administrator JWT"}` and
must have mode 600. Never put tokens in command arguments or source control.
Configuration uses the existing settings API, validates first, preserves other
settings, refuses a concurrent edit, saves a private rollback copy, and confirms
the running server adopted the path. It requires no backend restart. Use HTTPS
or loopback over SSH; redirects are rejected before forwarding authorization.

For every later deployment, run the read-only gate against the **interpreter
configured in the running server**:

```sh
python3 tools/native-analysis/provision.py --venv "$HOME/resonance-analysis/keyenv" --check
```

Provisioning installs the separately hash-locked pip version before detector
packages. The read-only gate checks both locks. If installer tooling is outdated,
wait for active analysis to finish, then rerun provisioning without `--check`.

Keep that environment and `analysis.essentia_python` across release changes and
backups. The Docker default `/opt/keyenv/bin/python` is not a native prerequisite.
Do not rebuild an environment during an active analysis scan. Changing the
published dependency lock requires rerunning its advisory checks and detector
probe before release. Enhanced analysis has separate model/worker requirements.

Regression checks, using the provisioned interpreter:

```sh
"$HOME/resonance-analysis/keyenv/bin/python" -m unittest discover \
  -s tools/native-analysis -p 'test_*.py'
```

The source-tree regression suite also runs the exact embedded Basic detector on
150 seconds of synthetic kicks. It checks beat coverage past the old 120-second
cutoff and timing against those known transients. `analysis.analysis_seconds` now
limits key estimation only; BPM/beat detection reads the full track, including
BPM-only rescans. Existing sampled beat grids need reanalysis; this does not
extend old timestamps by extrapolating a constant BPM.
