#!/usr/bin/env python3
"""Build a Linux Docker stack using a privately configured, managed SMB volume."""

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

from scripts.docker_smb import ensure_music_volume

ROOT = Path(__file__).resolve().parents[1]


def run(arguments, **kwargs):
    return subprocess.run([str(value) for value in arguments], check=True, **kwargs)


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as stream:
        temporary.chmod(0o600)
        json.dump(value, stream, indent=2)
        stream.write("\n")
    temporary.replace(path)


def validate_source(value):
    if "\0" in value or not re.fullmatch(r"//[^/\s,]+/[^\r\n,]+", value):
        raise ValueError("SMB source must be //server/share, without mount options")
    return value.rstrip("/")


def environment_text(values):
    lines = []
    for key, value in values.items():
        value = str(value)
        if any(char in value for char in "\r\n\0$#\"'"):
            raise ValueError("Unsupported character in deployment value: " + key)
        lines.append(key + "=" + value)
    return "\n".join(lines) + "\n"


def compose_command(environment):
    return [
        "docker",
        "compose",
        "--env-file",
        str(environment),
        "-f",
        str(ROOT / "docker/compose.portable.yml"),
    ]


def probe_music(volume, uid, gid):
    # Only this unique, zero-byte probe is created and removed. Existing music is
    # never replaced, copied into the share or changed by this check.
    name = ".resonance-smb-probe-" + uuid.uuid4().hex
    command = [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        f"{uid}:{gid}",
        "--mount",
        "type=volume,source=" + volume + ",target=/music,volume-nocopy",
        "alpine:3",
        "sh",
        "-ec",
        'set -C; p="/music/$1"; test -r /music; test ! -e "$p"; : > "$p"; rm -- "$p"',
        "probe",
        name,
    ]
    result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode:
        # Docker's daemon error can include credential-bearing mount options.
        raise RuntimeError(
            "SMB read/write probe failed; check share permissions, credentials and CIFS kernel support. Inspect daemon details privately."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path.home() / ".config/resonance-stack/config.json",
    )
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--import-state", type=Path)
    args = parser.parse_args()
    if sys.platform != "linux" and not args.plan:
        raise RuntimeError("This bootstrap targets Linux with a local Docker engine")
    if args.config.exists():
        config = json.loads(args.config.read_text())
    elif args.plan or not sys.stdin.isatty():
        raise RuntimeError(
            "Provide a private configuration JSON or run interactively once"
        )
    else:
        config = {
            "smbSource": input("Music share (//server/share): ").strip(),
            "stateDir": str(Path.home() / ".local/share/resonance-stack"),
            "httpBind": "127.0.0.1",
            "httpPort": 8080,
        }
        private_json(args.config, config)
    validate_source(config["smbSource"])
    name = config.get("stackName", "resonance-stack")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,50}", name):
        raise ValueError("Invalid stack name")
    state = Path(config["stateDir"]).expanduser().resolve()
    uid = int(config.get("uid", os.getuid() or 1000))
    gid = int(config.get("gid", os.getgid() or 1000))
    if uid <= 0 or gid <= 0:
        raise ValueError("The application must run as a non-root user")
    values = {
        "STACK_NAME": name,
        "APP_UID": uid,
        "APP_GID": gid,
        "STATE_DIR": state,
        "MUSIC_VOLUME_NAME": name + "_pending",
        "MUSIC_FILESYSTEM": "cifs",
        "HTTP_BIND": config.get("httpBind", "127.0.0.1"),
        "HTTP_PORT": int(config.get("httpPort", 8080)),
        "PEER_PORT": int(config.get("peerPort", 50300)),
    }
    for key in ("HTTP_PORT", "PEER_PORT"):
        if not 1 <= values[key] <= 65535:
            raise ValueError("Invalid port: " + key)
    environment_text(values)
    if args.plan:
        print("SMB:", config["smbSource"], "-> Docker-managed /downloads volume")
        print("Local state:", state)
        print("HTTP:", values["HTTP_BIND"], values["HTTP_PORT"])
        print(
            "Verify Docker plugins, build images, verify models, configure analysis and wait for API/web health"
        )
        return
    run([sys.executable, ROOT / "docker/scripts/install-docker-plugins.py"])
    endpoint = run(
        ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    if (
        endpoint not in {"unix:///var/run/docker.sock", "unix:///run/docker.sock"}
        or os.environ.get("DOCKER_HOST", endpoint) != endpoint
    ):
        raise RuntimeError("Bootstrap requires the local rootful Docker engine")
    values["MUSIC_VOLUME_NAME"] = ensure_music_volume(
        config, args.config.parent, name, uid, gid
    )
    probe_music(values["MUSIC_VOLUME_NAME"], uid, gid)
    state.mkdir(parents=True, exist_ok=True)
    if args.import_state:
        run(
            [
                sys.executable,
                ROOT / "docker/export-state.py",
                "import",
                "--archive",
                args.import_state.resolve(),
                "--app-dir",
                state,
            ]
        )
    for directory in (state / "data", state / "home", state / "incomplete"):
        directory.mkdir(parents=True, exist_ok=True)
    application = state / "resonance.yml"
    if not application.exists():
        application.write_text(
            "directories:\n  downloads: /downloads\n  incomplete: /config/incomplete\nshares:\n  directories:\n    - /downloads\nanalysis:\n  write_to_tags: false\n"
        )
        application.chmod(0o600)
    environment = state / "compose.env"
    environment.write_text(environment_text(values))
    environment.chmod(0o600)
    if not args.skip_build:
        run(
            [
                "docker",
                "build",
                "-f",
                "docker/prod.Dockerfile",
                "-t",
                "resonance-backend-base:portable",
                ".",
            ],
            cwd=ROOT,
        )
        run(
            [
                sys.executable,
                ROOT / "docker/scripts/build-bridge-worker.py",
                "--base",
                "resonance-backend-base:portable",
                "--tag",
                "resonance-backend-export:portable",
            ]
        )
        run([sys.executable, ROOT / "docker/scripts/build-analysis-worker.py"])
        run(
            [
                "docker",
                "build",
                "-f",
                "docker/web.Dockerfile",
                "--build-arg",
                "CADDYFILE=docker/caddy/Caddyfile.portable",
                "-t",
                "resonance-web:portable",
                ".",
            ],
            cwd=ROOT,
        )
    run(
        [
            sys.executable,
            ROOT / "docker/scripts/install-analysis-models.py",
            "--destination",
            state / "data/analysis-models",
        ]
    )
    command = [
        sys.executable,
        ROOT / "docker/scripts/configure-analysis-worker.py",
        "--data-dir",
        state / "data",
    ]
    if args.import_state:
        command.append("--relocate")
    run(command)
    if os.geteuid() == 0:
        run(["chown", "-R", f"{uid}:{gid}", state])
    run(compose_command(environment) + ["config", "--quiet"])
    run(compose_command(environment) + ["up", "-d", "--wait", "--wait-timeout", "900"])
    print(
        "Stack healthy. HTTP listener:",
        str(values["HTTP_BIND"]) + ":" + str(values["HTTP_PORT"]),
    )
    print(
        "Set up the first account in the UI, or sign in with the privately migrated account."
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
