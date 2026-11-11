#!/usr/bin/env python3
"""Install Resonance and its bundled enhanced analysis as one restartable app."""

import argparse
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


MARKER = "# Managed by ops/native/install-backend-service.py"
UNIT_NAME = "resonance-backend.service"
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_./:@%+,-]+$")
INHERITED_KEYS = {"PATH", "LANG", "LC_ALL", "LC_CTYPE"}


def safe_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute() or not SAFE_VALUE.fullmatch(str(path)):
        raise ValueError("Use an absolute path without spaces or shell characters")
    return path


def inherited_environment(pid):
    if not pid:
        return {}
    executable = Path(f"/proc/{pid}/exe")
    if executable.resolve().name != "resonance":
        raise ValueError("The inherited process is not a Resonance backend")
    values = {}
    for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        if b"=" not in item:
            continue
        key, value = item.split(b"=", 1)
        name = key.decode("ascii")
        if name.startswith(("RESONANCE_", "DOTNET_", "ASPNETCORE_")) or name in INHERITED_KEYS:
            values[name] = value.decode("utf-8")
    return values


def existing_environment(path):
    if not path.exists():
        return {}
    if path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError("The existing backend environment file is not private")
    lines = path.read_text().splitlines()
    if not lines or lines[0] != MARKER:
        raise ValueError("The existing backend environment file is not managed by this installer")
    values = {}
    for line in lines[1:]:
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or not SAFE_VALUE.fullmatch(value):
            raise ValueError("The existing backend environment file has an unsupported entry")
        values[key] = value
    return values


def render_environment(values):
    for key, value in values.items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or not SAFE_VALUE.fullmatch(value):
            raise ValueError(f"Unsupported backend environment value for {key}")
    return MARKER + "\n" + "".join(f"{key}={values[key]}\n" for key in sorted(values))


def render_unit(release_root, app_dir, working_dir, env_file, address, port):
    executable = release_root / "current/backend/resonance"
    return f"""{MARKER}
[Unit]
Description=Resonance native backend
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory={working_dir}
EnvironmentFile={env_file}
ExecStartPre=/usr/bin/test -x {executable}
ExecStart={executable} --app-dir {app_dir} --http-port {port} --http-ip-address {address} --no-https --content-path wwwroot
Restart=always
RestartSec=5
TimeoutStopSec=120
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
"""


def write_managed(path, content, mode):
    if path.exists():
        old = path.read_text()
        if not old.startswith(MARKER + "\n"):
            raise ValueError(f"Existing file is not managed by this installer: {path.name}")
        if old == content:
            return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", required=True)
    parser.add_argument("--app-dir", required=True)
    parser.add_argument("--working-dir", required=True)
    parser.add_argument("--analysis-bundle", help="defaults to the enhanced-analysis directory in the current app release")
    parser.add_argument("--candidate-timeout", type=int, default=3600)
    parser.add_argument("--http-address", default="127.0.0.1")
    parser.add_argument("--http-port", type=int, default=55450)
    parser.add_argument("--inherit-pid", type=int)
    parser.add_argument("--activate", action="store_true", help="start an inactive service after installation")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    release_root = safe_path(args.release_root)
    app_dir = safe_path(args.app_dir)
    working_dir = safe_path(args.working_dir)
    bundle = safe_path(args.analysis_bundle) if args.analysis_bundle else release_root / "current/enhanced-analysis"
    if not 1 <= args.http_port <= 65535 or args.candidate_timeout < 60:
        raise ValueError("Invalid backend port or enhanced analysis timeout")
    if args.http_address not in ("127.0.0.1", "0.0.0.0"):
        raise ValueError("Backend address must be loopback or all interfaces")
    for path in (release_root / "current/backend/resonance",):
        if not path.is_file() or not os.access(path, os.X_OK):
            raise ValueError("The backend executable is unavailable")
    if not (bundle / "bundle.json").is_file():
        raise ValueError("The release has no enhanced analysis bundle")
    for path in (app_dir, working_dir):
        if not path.is_dir():
            raise ValueError("A required application directory is unavailable")

    env_file = Path.home() / ".config/resonance/backend.env"
    unit_file = Path.home() / ".config/systemd/user" / UNIT_NAME
    values = existing_environment(env_file)
    values.update(inherited_environment(args.inherit_pid))
    for key in ("RESONANCE_CANDIDATE_PYTHON", "RESONANCE_CANDIDATE_WORKER", "RESONANCE_CANDIDATE_CONFIG"):
        values.pop(key, None)
    values["RESONANCE_CANDIDATE_TIMEOUT_SECONDS"] = str(args.candidate_timeout)
    environment = render_environment(values)
    unit = render_unit(release_root, app_dir, working_dir, env_file, args.http_address, args.http_port)
    if args.dry_run:
        print("Backend release and enhanced bundle are present; service is ready to install.")
        return

    subprocess.run(["python3", str(Path(__file__).with_name("enhanced-bundle.py")), "install",
                    "--bundle", str(bundle), "--app-dir", str(app_dir)], check=True)
    write_managed(env_file, environment, 0o600)
    write_managed(unit_file, unit, 0o644)
    subprocess.run(["systemd-analyze", "verify", str(unit_file)], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", UNIT_NAME], check=True)
    if args.activate:
        running = subprocess.run(["systemctl", "--user", "is-active", "--quiet", UNIT_NAME], check=False).returncode == 0
        if running:
            raise ValueError("Service is already active; drain any scan before restarting it")
        subprocess.run(["systemctl", "--user", "start", UNIT_NAME], check=True)
    print("Resonance and bundled enhanced analysis installed as a restartable app.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Backend service installation failed: {type(error).__name__}") from error
