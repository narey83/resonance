#!/usr/bin/env python3
"""Acquire pinned model assets explicitly at deployment; inference stays offline."""

import argparse
import hashlib
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "backend/data/analysis-models"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(row):
    relative = Path(row["file"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Model destination must stay inside model storage")
    path = DEST / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        part = path.with_suffix(path.suffix + ".part")
        with (
            urllib.request.urlopen(row["url"], timeout=120) as response,
            part.open("wb") as stream,
        ):
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
        if part.stat().st_size != row["bytes"] or digest(part) != row["sha256"]:
            raise ValueError(f"Model integrity mismatch: {relative}")
        part.replace(path)
    if path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
        raise ValueError(f"Model integrity mismatch: {relative}")
    print(f"Verified {relative}", flush=True)
    return row


def main():
    global DEST
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=DEST)
    DEST = parser.parse_args().destination.expanduser().resolve()
    lock = json.loads((ROOT / "tools/analysis-worker/models.lock.json").read_text())
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(fetch, lock["files"]))
    folds = [
        dict(row, file=Path(row["file"]).name)
        for row in rows
        if row["file"].startswith("allinone/harmonix-")
    ]
    if len(folds) != 8 or len({row["file"] for row in folds}) != 8:
        raise ValueError("Eight distinct verified semantic checkpoints are required")
    (DEST / "allinone/provenance.json").write_text(
        json.dumps({"files": folds}, indent=2) + "\n"
    )
    (DEST / "provenance.json").write_text(json.dumps(lock, indent=2) + "\n")


if __name__ == "__main__":
    main()
