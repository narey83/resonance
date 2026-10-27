#!/usr/bin/env python3
"""Install missing Docker CLI plugins from checksum-verified official releases."""

import hashlib
import json
import platform
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen


def read(url):
    with urlopen(
        Request(url, headers={"User-Agent": "ResonanceBootstrap"}), timeout=120
    ) as response:
        data = response.read(160 * 1024 * 1024 + 1)
    if len(data) > 160 * 1024 * 1024:
        raise ValueError("Docker plugin download exceeds its size bound")
    return data


def install(plugin, repository):
    if (
        subprocess.run(
            ["docker", plugin, "version"], capture_output=True, check=False
        ).returncode
        == 0
    ):
        return
    architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if not architecture:
        raise RuntimeError("Unsupported Docker plugin architecture")
    release = json.loads(
        read("https://api.github.com/repos/docker/" + repository + "/releases/latest")
    )
    if plugin == "compose":
        name = (
            "docker-compose-linux-"
            + {"amd64": "x86_64", "arm64": "aarch64"}[architecture]
        )
    else:
        name = "buildx-" + release["tag_name"] + ".linux-" + architecture
    artifact = next(asset for asset in release["assets"] if asset["name"] == name)
    checksum = next(
        (asset for asset in release["assets"] if asset["name"] == name + ".sha256"),
        None,
    )
    if checksum:
        expected = read(checksum["browser_download_url"]).decode().split()[0]
    else:
        checksum = next(
            asset
            for asset in release["assets"]
            if asset["name"].lower() == "checksums.txt"
        )
        expected = next(
            line.split()[0]
            for line in read(checksum["browser_download_url"]).decode().splitlines()
            if line.split()[-1].lstrip("*") == name
        )
    data = read(artifact["browser_download_url"])
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Docker plugin checksum mismatch")
    directory = Path.home() / ".docker/cli-plugins"
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / ("docker-" + plugin)
    temporary = destination.with_suffix(".partial")
    temporary.write_bytes(data)
    temporary.chmod(0o755)
    if destination.exists():
        raise RuntimeError(
            "An existing non-working user plugin was preserved: " + str(destination)
        )
    temporary.replace(destination)
    subprocess.run(["docker", plugin, "version"], check=True)


if __name__ == "__main__":
    install("compose", "compose")
    install("buildx", "buildx")
