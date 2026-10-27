#!/usr/bin/env python3
"""Privately export/import application state with consistent SQLite backups."""

import argparse
import hashlib
import json
import shutil
import sqlite3
import tarfile
import tempfile
from pathlib import Path


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def export_state(application, archive):
    if archive.is_relative_to(application):
        raise ValueError("Write the private archive outside the application directory")
    if archive.exists():
        raise ValueError("Archive already exists; choose a new output file")
    data = application / "data"
    if not (data / "resonance.db").is_file():
        raise ValueError("Active SQLite application database not found")
    candidates = data / "candidates"
    if candidates.exists():
        for job in candidates.glob("*/job.json"):
            if (
                json.loads(job.read_text())
                .get("Status", json.loads(job.read_text()).get("status", ""))
                .lower()
                == "running"
            ):
                raise ValueError(
                    "Analysis is running; finish or stop it before making a migration archive"
                )
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="resonance-state-") as temporary:
        staging = Path(temporary)
        manifest = {"schemaVersion": 1, "databases": {}}
        with archive.open("xb") as stream:
            archive.chmod(0o600)
            with tarfile.open(fileobj=stream, mode="w:gz", compresslevel=1) as output:
                for directory in [
                    application / "data",
                    application / "bridge-releases",
                ]:
                    if not directory.exists():
                        continue
                    for path in sorted(directory.rglob("*")):
                        if not path.is_file() or path.is_symlink():
                            continue
                        relative = path.relative_to(application)
                        if "bin" in relative.parts or path.name.endswith(
                            ("-wal", "-shm", "-journal")
                        ):
                            continue
                        with path.open("rb") as source:
                            is_database = source.read(16) == b"SQLite format 3\x00"
                        if is_database:
                            backup = staging / relative
                            backup.parent.mkdir(parents=True, exist_ok=True)
                            with (
                                sqlite3.connect(
                                    path.resolve().as_uri() + "?mode=ro",
                                    uri=True,
                                    timeout=30,
                                ) as source,
                                sqlite3.connect(backup) as target,
                            ):
                                source.backup(target)
                            manifest["databases"][str(relative)] = sha(backup)
                            output.add(backup, arcname=str(relative), recursive=False)
                        else:
                            output.add(path, arcname=str(relative), recursive=False)
                if (application / "resonance.yml").is_file():
                    output.add(
                        application / "resonance.yml",
                        arcname="resonance.yml",
                        recursive=False,
                    )
                metadata = staging / "migration.json"
                metadata.write_text(json.dumps(manifest, indent=2))
                output.add(metadata, arcname="migration.json", recursive=False)
    checksum = archive.with_name(archive.name + ".sha256")
    checksum.write_text(sha(archive) + "\n")
    checksum.chmod(0o600)


def import_state(archive, application):
    marker = application / "migration.archive.sha256"
    if marker.exists() and marker.read_text().strip() == sha(archive):
        return
    if (application / "data/resonance.db").exists():
        raise ValueError(
            "Existing application database preserved; import into an unused state directory"
        )
    expected = archive.with_name(archive.name + ".sha256").read_text().strip()
    if len(expected) != 64 or sha(archive) != expected:
        raise ValueError("Migration archive checksum mismatch")
    with tempfile.TemporaryDirectory(
        prefix="resonance-import-", dir=application.parent
    ) as temporary:
        staging = Path(temporary)
        with tarfile.open(archive, "r:gz") as source:
            for member in source.getmembers():
                relative = Path(member.name)
                if (
                    relative.is_absolute()
                    or ".." in relative.parts
                    or not member.isfile()
                ):
                    raise ValueError("Unsafe migration archive entry")
                destination = staging / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with (
                    source.extractfile(member) as reader,
                    destination.open("xb") as writer,
                ):
                    destination.chmod(0o600)
                    shutil.copyfileobj(reader, writer)
        manifest = json.loads((staging / "migration.json").read_text())
        if (
            manifest.get("schemaVersion") != 1
            or "data/resonance.db" not in manifest["databases"]
        ):
            raise ValueError(
                "Migration manifest does not contain the application database"
            )
        for name, expected in manifest["databases"].items():
            path = staging / name
            if (
                path.resolve().parent != staging.resolve()
                and not path.resolve().is_relative_to(staging.resolve())
            ):
                raise ValueError("Unsafe database path")
            if sha(path) != expected:
                raise ValueError("Database backup checksum mismatch")
            with sqlite3.connect(
                path.resolve().as_uri() + "?mode=ro", uri=True
            ) as database:
                if database.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise ValueError("Database backup integrity check failed")
        application.mkdir(parents=True, exist_ok=True)
        for path in staging.rglob("*"):
            if path.is_file():
                destination = application / path.relative_to(staging)
                if destination.exists():
                    raise ValueError(
                        "Existing state file preserved: "
                        + str(path.relative_to(staging))
                    )
        for path in staging.rglob("*"):
            if path.is_file():
                destination = application / path.relative_to(staging)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(path, destination)
        marker.write_text(sha(archive) + "\n")
        marker.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "import"])
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "export":
        export_state(args.app_dir.resolve(), args.archive.resolve())
    else:
        args.app_dir.parent.mkdir(parents=True, exist_ok=True)
        import_state(args.archive.resolve(), args.app_dir.resolve())
    print(
        "Private state "
        + args.action
        + " completed; do not commit this archive or its contents"
    )


if __name__ == "__main__":
    main()
