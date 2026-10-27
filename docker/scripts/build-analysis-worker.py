#!/usr/bin/env python3
"""Build analysis tooling without putting application data or credentials in context."""

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="resonance-backend-export:portable")
    parser.add_argument("--tag", default="resonance-backend:portable")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="resonance-analysis-build-") as temporary:
        context = Path(temporary)
        shutil.copytree(
            root / "tools/analysis-worker",
            context / "tools/analysis-worker",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        (context / "docker/scripts").mkdir(parents=True)
        shutil.copy2(
            root / "docker/scripts/music-mount-guard.py",
            context / "docker/scripts/music-mount-guard.py",
        )
        shutil.copy2(root / "docker/analysis-worker.Dockerfile", context / "Dockerfile")
        subprocess.run(
            [
                "docker",
                "build",
                "--build-arg",
                "BASE_IMAGE=" + args.base,
                "--tag",
                args.tag,
                str(context),
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
