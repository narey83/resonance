#!/usr/bin/env python3
"""Refresh Caddy inside the frontend image, with health checks and image rollback."""

import argparse
import fcntl
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from bootstrap import ROOT, compose_command


def build_commands(config):
    commands = []
    runtime = (
        config.get("tlsImage", "resonance-caddy:portable")
        if config.get("tlsEnabled")
        else "caddy:2"
    )
    if config.get("tlsEnabled"):
        commands.append(
            [
                "docker",
                "build",
                "--pull",
                "--no-cache",
                "-f",
                "docker/caddy/Dockerfile",
                "-t",
                runtime,
                ".",
            ]
        )
    web = ["docker", "build", "-f", "docker/web.Dockerfile"]
    if not config.get("tlsEnabled"):
        web.append("--pull")
    web += [
        "--no-cache-filter",
        "runtime",
        "--build-arg",
        "CADDYFILE=docker/caddy/Caddyfile.portable",
        "--build-arg",
        "CADDY_RUNTIME_IMAGE=" + runtime,
        "-t",
        "resonance-web:portable",
        ".",
    ]
    commands.append(web)
    return commands


def update(config, environment, run):
    backup = "resonance-web:rollback-" + datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    activate = compose_command(
        environment,
        config.get("hostNetworking", False),
        config.get("tlsEnabled", False),
    )
    activate += ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "180", "web"]
    run(["docker", "image", "tag", "resonance-web:portable", backup])
    activation_attempted = False
    try:
        for command in build_commands(config):
            run(command)
        run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "caddy",
                "resonance-web:portable",
                "version",
            ]
        )
        validate = ["docker", "run", "--rm", "--network", "none"]
        if config.get("tlsEnabled"):
            validate += [
                "--mount",
                "type=bind,source="
                + str(Path(config["tlsCaddyfile"]).expanduser().resolve())
                + ",target=/etc/caddy/Caddyfile,readonly",
            ]
        validate += [
            "--entrypoint",
            "caddy",
            "resonance-web:portable",
            "validate",
            "--config",
            "/etc/caddy/Caddyfile",
            "--adapter",
            "caddyfile",
        ]
        run(validate)
        activation_attempted = True
        run(activate)
    except (subprocess.CalledProcessError, OSError):
        run(["docker", "image", "tag", backup, "resonance-web:portable"])
        if activation_attempted:
            run(activate)
        raise
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path.home() / ".config/resonance-stack/config.json",
    )
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    environment = Path(config["stateDir"]).expanduser() / "compose.env"
    if args.plan:
        print(json.dumps(build_commands(config), indent=2))
        print(
            "Validate Caddy; replace only the frontend; restore its previous image if activation fails."
        )
        return
    if not environment.is_file():
        raise SystemExit("Run docker/bootstrap.py before updating the frontend")
    directory = args.config.parent / "updates"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = directory / "frontend.lock"
    with lock.open("a") as stream:
        lock.chmod(0o600)
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("A frontend update is already running") from None
        log = directory / (
            "frontend-" + datetime.now(UTC).strftime("%Y%m%d-%H%M%S") + ".log"
        )
        with log.open("w") as output:
            log.chmod(0o600)

            def run(command):
                subprocess.run(
                    command,
                    cwd=ROOT,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    check=True,
                )

            try:
                backup = update(config, environment, run)
            except (subprocess.CalledProcessError, OSError):
                raise SystemExit(
                    "Frontend update failed; inspect the private log: " + str(log)
                ) from None
        print("Frontend/Caddy updated and healthy. Previous image: " + backup)
        print("Private update log: " + str(log))


if __name__ == "__main__":
    main()
