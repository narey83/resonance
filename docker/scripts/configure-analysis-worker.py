#!/usr/bin/env python3
"""Generate deployment paths for the tested, explicitly installed analysis stack."""

import argparse
import json
from pathlib import Path


def configuration(
    example, data_root="/config/data", worker_root="/opt/resonance-analysis/worker"
):
    config = json.loads(json.dumps(example))
    models = data_root + "/analysis-models/"
    config.update(
        ffmpeg="/opt/resonance-tools/ffmpeg",
        timeoutSeconds=3500,
        overallTimeoutSeconds=3500,
    )
    config["beats"]["checkpoint"] = models + "beats/beat_this-final0.ckpt"
    config["embedding"]["snapshot"] = models + "clap"
    config["key"].update(
        python="/opt/keyenv/bin/python",
        pythonPath="/opt/keyenv/lib/python3.12/site-packages",
    )
    config["stems"].update(
        python=config["python"],
        pythonPath="/opt/resonance/venvs/beats/lib/python3.12/site-packages",
        modelRoot=models + "demucs",
    )
    config["semanticPhrases"].update(
        python=config["python"],
        adapter=worker_root + "/optional-allinone/ensemble_adapter.py",
        sourceRoot=worker_root + "/optional-allinone/author-source",
        checkpoint=models + "allinone/harmonix-fold0-0vra4ys2.pth",
        ensembleManifest=models + "allinone/provenance.json",
    )
    config["vocalPresence"]["checkpoint"] = models + "singing/model.pt"
    config["vocalPresence"]["processedVoice"]["checkpoint"] = (
        models + "voice/silero_vad.jit"
    )
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument(
        "--relocate",
        action="store_true",
        help="Translate paths in privately imported configuration",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    destination = args.data_dir / "analysis-config.json"
    if destination.exists() and not args.relocate:
        print("Existing analysis configuration preserved")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = (
        destination
        if destination.exists()
        else root / "tools/analysis-worker/config.example.json"
    )
    config = configuration(json.loads(source.read_text()))
    if destination.exists():
        destination.replace(destination.with_suffix(".before-relocation.json"))
    with destination.open("x") as stream:
        destination.chmod(0o600)
        stream.write(json.dumps(config, indent=2) + "\n")


if __name__ == "__main__":
    main()
