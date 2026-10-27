# Move Resonance to a Linux Docker host

The portable stack builds from this checkout. It uses two services: the backend
(including its media, export and analysis tools) and the static web UI/proxy
(including maintenance coordination and optional HTTPS in its built-in Caddy). It needs no development-server images,
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

When an existing HTTPS proxy forwards to this HTTP listener, add its exact IP/CIDR
to the private JSON trustedProxies list. This preserves the original HTTPS scheme
and client address for login throttling, pairing URLs and WebSocket origin checks.
Only loopback is trusted by default; direct LAN clients cannot supply trusted
forwarded headers.

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
models and the existing signed Bridge installers/update files. Known development-only\nmedia-tool paths and the saved DLNA bind address are relocated during a fresh import. It does not alter
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

For Samba 4.22+ and a compatible Linux CIFS client, set smbPosix to true to
preserve Linux filenames, including trailing spaces. This deployment was verified
with Samba 4.23.8 and Linux 7.0: all 59,402 original indexed paths matched after
mounting with encrypted SMB 3.1.1 POSIX extensions. The old mount definition is
preserved when the POSIX option creates a separate managed volume.

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
tuning is separate from this migration. For Linux LAN discovery, explicitly set
hostNetworking and dlnaEnabled to true, and lanAddress to the host LAN IP in
the private JSON. This adds the host-network override for the backend: its
authenticated API on 5030, DLNA on 8200 and peer port 50300 listen on the host.
The web proxy remains on its configured HTTP listener. Only enable this on a
trusted LAN; it shares the host network namespace with the backend. Hardware acceptance for Network Link
and USB export remains experimental. See [analysis deployment and its remaining
dependency advisory](../docs/dj-workspace.md#independent-enhanced-analysis).

The migration helpers have fixture tests and Compose validation. Installing on the
new physical host, its SMB credentials and its boot ordering must still be verified
there; repository checks cannot establish those environment-specific results.


## Laptop hosts

To keep a Linux laptop serving Resonance with its lid closed, install the optional
user service and enable the user manager at boot and after logout:

~~~sh
install -Dm644 docker/systemd/resonance-lid-inhibitor.service   "$HOME/.config/systemd/user/resonance-lid-inhibitor.service"
loginctl --no-ask-password enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now resonance-lid-inhibitor.service
systemd-inhibit --list
~~~

The service holds a low-level lid-switch inhibitor. On GNOME desktops, also save
the existing power preferences and set sleep-inactive-ac-type and
sleep-inactive-battery-type to nothing in the
org.gnome.settings-daemon.plugins.power schema, so idle suspend does not stop the
server after the lid is closed. The deployment keeps the previous values in the
private power-before.json file beside its bootstrap configuration.

Check the service is active and enabled, and loginctl reports Linger=yes. A real
lid-close or reboot test still needs to be performed on the hardware.

## Frontend with built-in HTTPS Caddy

The runtime containers are resonance-frontend and resonance-backend. Dozzle is
installed as its own Compose project. There is no standalone Resonance Caddy
container: the frontend serves the compiled UI and proxies API/hub requests.

For direct HTTPS on port 8443, set tlsEnabled to true, tlsCaddyfile to the
absolute path of a private production Caddyfile, and tlsImage to the Caddy runtime
image containing the required modules. The frontend build embeds that runtime;
the TLS override mounts the private configuration and persistent certificate
volume into the frontend. The private file must serve /srv, proxy API/hub traffic
to backend:5030, and maintenance traffic to 127.0.0.1:8090. DNS API credentials
and certificate keys belong outside Git. Back up that configuration and the
external TLS data volume privately alongside the application state.

### Update Caddy and frontend independently

From the checkout:

~~~sh
python3 docker/update-frontend.py --plan
python3 docker/update-frontend.py
~~~

The updater pulls the current Caddy build/runtime images and rebuilds its modules,
rebuilds the frontend runtime, validates its Caddyfile, and replaces only the
frontend. It retains the previous frontend image and restores it if activation
fails. The backend and analysis images are not rebuilt; application data, private
configuration and certificate volumes are retained. Update output is stored in a
private log beside the bootstrap configuration. Updates run when this command is
invoked.

### Collect startup warnings and errors

~~~sh
python3 docker/collect-runtime-logs.py \
  --container resonance-backend --container resonance-frontend --container dozzle \
  --secret-file "$HOME/.local/share/resonance-stack/resonance.yml" \
  --secret-file "$HOME/.config/resonance-stack/https/Caddyfile" \
  --output "$HOME/resonance-support"
~~~

The bundle includes all Docker logs still available for the selected containers,
separate warning/error files and a count summary. Credentials and token-bearing
headers/queries are redacted; files are private. Historical application logs
remain in the migrated SQLite database.

A GitHub 401 during release checking means the saved release-check credential is
invalid. Supply a valid credential with read access to the private release
repository through the instance settings; never copy a broader push credential
into the application just to suppress the warning.

For a host whose checkout is ~/projects/resonance, the optional user unit
docker/systemd/resonance-stack.service retries startup if Docker or the SMB server
is not available during boot. Install it under ~/.config/systemd/user, enable
user lingering and enable the unit. Container restart policies handle process
restarts after startup; this unit handles the initial network-mount dependency.
