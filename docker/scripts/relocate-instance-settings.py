#!/usr/bin/env python3
"""Relocate known development-host settings after a fresh private state import."""

import argparse
import ipaddress
import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path


def relocate(data, lan_address=None):
    data = data.resolve()
    database = data / "resonance.db"
    if not database.is_file():
        raise ValueError("Imported SQLite database not found")
    if lan_address:
        lan_address = str(ipaddress.ip_address(lan_address))
    changes = []
    with closing(
        sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=30)
    ) as connection:
        values = dict(connection.execute('SELECT "Key", "Value" FROM "Setting"'))
        replacements = {
            "resonance:integrations:yt_dlp:executable_path": (
                "/src/backend/tools/yt-dlp",
                "yt-dlp",
            ),
            "resonance:integrations:yt_dlp:ffmpeg_path": (
                "/src/backend/tools/ffmpeg",
                "ffmpeg",
            ),
        }
        for key, (old, new) in replacements.items():
            if values.get(key) == old:
                changes.append({"key": key, "old": old, "new": new})
        key = "resonance:dlna:bind_address"
        if lan_address and values.get(key) and values[key] != lan_address:
            ipaddress.ip_address(values[key])
            changes.append({"key": key, "old": values[key], "new": lan_address})
        key = "resonance:soulseek:picture"
        old = values.get(key, "")
        prefix = "/src/backend/data/"
        if old.startswith(prefix):
            relative = Path(old[len(prefix) :])
            target = (data / relative).resolve()
            if target.is_relative_to(data) and target.is_file():
                changes.append(
                    {
                        "key": key,
                        "old": old,
                        "new": "/config/data/" + relative.as_posix(),
                    }
                )
        if changes:
            backup = data / (
                "instance-relocation-"
                + datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
                + ".json"
            )
            with backup.open("x") as stream:
                backup.chmod(0o600)
                json.dump(changes, stream, indent=2)
            with connection:
                for change in changes:
                    result = connection.execute(
                        'UPDATE "Setting" SET "Value"=? WHERE "Key"=? AND "Value"=?',
                        (change["new"], change["key"], change["old"]),
                    )
                    if result.rowcount != 1:
                        raise RuntimeError("Setting changed during relocation")
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--lan-address")
    args = parser.parse_args()
    print(
        "Relocated instance settings:", len(relocate(args.data_dir, args.lan_address))
    )


if __name__ == "__main__":
    main()
