# Move Resonance to a Linux Docker host

The portable stack builds from this checkout. It uses two services: the backend
(including its media, export and analysis tools) and the static web UI/proxy
(including maintenance coordination). It needs no development-server images,
external Docker networks, PostgreSQL service or extra Bridge container.

Keep the checkout and application state on the new host's local disk. Only music
uses the existing server's SMB share. The container path remains `/downloads`, so
the existing library's relative paths continue to work.

## First installation

Install Docker Engine on the Linux host, then clone this
repository using your normal GitHub authentication:

```sh
git clone https://github.com/narey83/resonance.git
cd resonance
python3 docker/bootstrap.py
```

The first run asks for `//server/share`, the SMB username and password. It saves
credentials in a mode-0600 file outside the checkout and creates a private
configuration at `~/.config/resonance-stack/config.json`. It uses your existing
Docker access without installing privileged host packages. Missing Compose
and Buildx CLI plugins are installed in the invoking user home from checksum-verified
official Docker releases. The music mount is managed by Docker; no host mount helper
or fstab edits are required. Subsequent runs reuse those settings. No source edits, Python environments or
worker-path configuration are required.

The bootstrap builds the production API, export tools, analysis runtime and web
images, verifies/downloads the pinned models, generates the analysis settings,
starts the services and waits for API/web health. The first build and roughly
1 GiB of model downloads take time. Inference then uses local models. The models
and analysis results persist in the local state directory across image rebuilds.

HTTP initially binds to `127.0.0.1:8080`. Set `httpBind` to the new host's LAN
address, or `0.0.0.0`, in the private configuration and rerun to make it reachable
over that network. Use your HTTPS reverse proxy for Internet access. Soulseek's
peer port defaults to 50300. Configure the first account in the web UI and supply
your Soulseek settings there. No account or SMB passwords belong in GitHub.

Docker persists the CIFS volume and remounts it when the stack starts after reboot.
Its `unless-stopped` containers resume with the Docker daemon. Backend startup
refuses to index if `/downloads` is not actually CIFS/SMB, and refuses network
storage for `/config`/SQLite. This prevents an unavailable share being mistaken for
an emptied library. Docker operators already have root-equivalent access and can
inspect the volume mount options, including its credentials; keep Docker access
restricted. Passwords are never placed in command arguments or the generated
Compose environment file, and are never committed to GitHub.

The current development server exports `music_network` from its music disk through
its existing Samba Docker container. The `ServerStore` share remains separate.
The new host acts as a client; it does not run another Samba server.

## Carry across the existing instance

GitHub contains source and build instructions. Move accounts, settings, pairing
records, analysis and the active database through a private archive instead.
Finish active analysis before exporting. On the current dev server:

```sh
cd /mnt/data/projects/resonance
python3 docker/export-state.py export \
  --app-dir backend \
  --archive "$HOME/resonance.state.tar.gz"
```

The exporter uses SQLite's online backup API for each database, omits transient
journals, downloaded executable caches and historical database conversion backups,
and includes completed analysis,
models and the existing signed Bridge installers/update files. It does not alter
the live database or touch PostgreSQL. The archive and checksum are private files;
transfer both directly to the new host over SSH, outside the repository.

After exporting, stop the old Resonance backend while leaving its SMB service running.
On the new host, use the same bootstrap with the private archive:

```sh
python3 docker/bootstrap.py --import-state "$HOME/resonance.state.tar.gz"
```

Import verifies the archive checksum, safe member paths, database checksums and
SQLite integrity. It preserves existing databases rather than replacing them.
Repeating the same completed import is safe. The bootstrap relocates the imported
worker configuration to the packaged paths while preserving its engine choices,
and verifies cached model files before starting.

At cutover, stop the old stack's download/tag/preparation jobs before allowing the
new stack to write to the same music share. Update your reverse proxy/DNS for the
new web host. If the server URL changes, pair Bridge with that new address in its
Settings page. The SMB music host can remain the old development server. Keep the
old database and backups until the new instance has been checked.

## Options and checks

The private JSON supports `smbSource`, `smbUsername`, `smbCredentialsFile`,
`stateDir`, `httpBind`, `httpPort`, `peerPort`, `uid`, `gid` and `stackName`.
Defaults use the invoking Linux user's UID/GID (1000 when invoked as root).
The supported automatic host setup uses a local rootful Docker engine; remote
Docker contexts and rootless Docker need separate integration.

```sh
# Inspect the non-secret plan without mounting, building or starting anything
python3 docker/bootstrap.py --config /path/to/private-config.json --plan

# Reuse images after the initial build; models are still verified
python3 docker/bootstrap.py --skip-build

# Regression checks, without mounting host filesystems or reading live databases
python3 -m unittest discover -s docker/tests -p test_portable_stack.py -v
python3 -m unittest discover -s docker/scripts -p test_install_analysis_models.py -v
```

The larger host has no inherited 1.5-CPU development-container ceiling. The tested
inference thread limits and single-track queue remain unchanged; concurrency
tuning is separate from this migration. DLNA discovery needs LAN multicast
networking beyond the default Docker bridge. Hardware acceptance for Network Link
and USB export remains experimental. See [analysis deployment and its remaining
dependency advisory](../docs/dj-workspace.md#independent-enhanced-analysis).

The migration helpers have fixture tests and Compose validation. Installing on the
new physical host, its SMB credentials and its boot ordering must still be verified
there; repository checks cannot establish those environment-specific results.
