#!/usr/bin/env python3
"""Turn the existing Resonance CIFS volume into a boot-safe /downloads automount.

Run on the dev laptop. The current Docker volume supplies the share address and
credentials; neither is printed or committed to the repository.
"""

import argparse
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys

VOLUME = "resonance-stack_music_b723e958870a"
MOUNT_POINT = Path("/downloads")
HOST = "192.168.0.254"
CREDENTIALS = Path("/etc/resonance/downloads.credentials")
MOUNT_UNIT = Path("/etc/systemd/system/downloads.mount")
AUTOMOUNT_UNIT = Path("/etc/systemd/system/downloads.automount")
ALLOWED_OPTIONS = {"addr", "gid", "nodev", "noexec", "nosuid", "posix", "seal", "uid", "vers"}


def read_volume():
    result = subprocess.run(
        ["docker", "volume", "inspect", VOLUME],
        check=True,
        capture_output=True,
        text=True,
    )
    volume = json.loads(result.stdout)[0]
    options = volume.get("Options") or {}
    if options.get("type") != "cifs":
        raise ValueError("The saved music volume is not CIFS")
    device = options.get("device", "")
    if not device.startswith(f"//{HOST}/") or any(char in device for char in "\n\r\t "):
        raise ValueError("The saved music share does not match the expected host")

    mount_options = {}
    for part in options.get("o", "").split(","):
        key, separator, value = part.partition("=")
        if not key or key in mount_options:
            raise ValueError("Invalid or duplicate saved mount option")
        mount_options[key] = value if separator else None
    if mount_options.get("addr") != HOST:
        raise ValueError("The saved music share address does not match")
    if not mount_options.get("username") or not mount_options.get("password"):
        raise ValueError("The saved music volume has no credentials")
    if "seal" not in mount_options:
        raise ValueError("The saved music volume does not require SMB encryption")
    if any("\n" in mount_options[key] or "\r" in mount_options[key] for key in ("username", "password")):
        raise ValueError("The saved music credentials cannot be written safely")
    if set(mount_options) - ALLOWED_OPTIONS - {"username", "password"}:
        raise ValueError("The saved music volume has unexpected mount options")

    user = pwd.getpwnam("narey")
    if mount_options.get("uid") != str(user.pw_uid) or mount_options.get("gid") != str(user.pw_gid):
        raise ValueError("The saved music volume is not owned by the app user")
    return device, mount_options


def write_new(path, content, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, "w") as output:
        output.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="validate the saved volume without changing the system")
    args = parser.parse_args()
    device, options = read_volume()
    if not MOUNT_POINT.is_dir():
        raise ValueError("/downloads is not a directory")
    if MOUNT_POINT.is_mount():
        raise ValueError("/downloads is already mounted; leave the working share in place")
    existing = [path for path in (CREDENTIALS, MOUNT_UNIT, AUTOMOUNT_UNIT) if path.exists()]
    if existing:
        raise ValueError("An existing credentials file or downloads systemd unit needs review")
    if not Path("/sbin/mount.cifs").is_file():
        raise ValueError("Install cifs-utils before configuring the CIFS automount")
    if args.dry_run:
        print("Saved CIFS share verified. Would install a protected credentials file and on-demand /downloads mount.")
        return
    if os.geteuid() != 0:
        raise PermissionError("Run this installer with sudo on the dev laptop")

    CREDENTIALS.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    write_new(CREDENTIALS, f"username={options.pop('username')}\npassword={options.pop('password')}\n", 0o600)
    option_text = ",".join(
        [f"credentials={CREDENTIALS}", "_netdev"] +
        [f"{key}={value}" if value is not None else key for key, value in options.items()]
    )
    write_new(MOUNT_UNIT, f"""[Unit]
Description=Resonance music share
Wants=network-online.target
After=network-online.target

[Mount]
What={device}
Where={MOUNT_POINT}
Type=cifs
Options={option_text}
TimeoutSec=60s
""", 0o644)
    write_new(AUTOMOUNT_UNIT, f"""[Unit]
Description=Mount Resonance music share on demand

[Automount]
Where={MOUNT_POINT}
TimeoutIdleSec=0

[Install]
WantedBy=multi-user.target
""", 0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "downloads.automount"], check=True)
    subprocess.run(["systemctl", "start", "downloads.mount"], check=True)
    filesystem = subprocess.run(
        ["findmnt", "-n", "-o", "FSTYPE", "-T", str(MOUNT_POINT)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if filesystem != "cifs":
        raise RuntimeError("The music share did not mount as CIFS")
    user = pwd.getpwnam("narey")
    writable = subprocess.run(
        ["runuser", "-u", user.pw_name, "--", "test", "-w", str(MOUNT_POINT)],
        check=False,
    ).returncode == 0
    if not writable:
        raise RuntimeError("The music share mounted but is not writable by Resonance")
    print("/downloads is mounted, writable by Resonance, and configured to remount after reboot.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Mount setup failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
