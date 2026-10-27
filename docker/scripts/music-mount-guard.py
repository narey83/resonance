"""Fail closed before indexing if SMB is absent or SQLite would be on a network FS."""

import os
import re
import sys
from pathlib import Path

NETWORK_FILESYSTEMS = {"cifs", "smb3", "nfs", "nfs4", "fuse.sshfs", "9p"}


def filesystem(path, mountinfo):
    matches = []
    for line in mountinfo.splitlines():
        left, separator, right = line.partition(" - ")
        fields = left.split()
        if not separator or len(fields) < 5:
            continue
        mountpoint = re.sub(
            r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4]
        )
        if path == mountpoint or path.startswith(mountpoint.rstrip("/") + "/"):
            matches.append((len(mountpoint), right.split()[0]))
    if not matches:
        raise RuntimeError("Cannot establish the filesystem backing " + path)
    return max(matches)[1]


def validate(mountinfo, expected_music):
    if filesystem("/config", mountinfo) in NETWORK_FILESYSTEMS:
        raise RuntimeError("SQLite and application state must be on local disk")
    actual = filesystem("/downloads", mountinfo)
    if expected_music == "cifs" and actual not in {"cifs", "smb3"}:
        raise RuntimeError(
            "The SMB music share is not mounted; refusing to index an empty local directory"
        )


def main():
    validate(
        Path("/proc/self/mountinfo").read_text(),
        os.environ.get("RESONANCE_MUSIC_FILESYSTEM", "cifs"),
    )
    if len(sys.argv) < 2:
        raise SystemExit("Expected the backend command")
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
