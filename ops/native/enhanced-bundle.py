#!/usr/bin/env python3
"""Build and install a self-contained Linux enhanced-analysis app bundle.

Build on the target architecture from verified, already installed environments.
The resulting directory belongs in a Resonance release. Installation is offline.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid


def copy_directory(source, destination):
    shutil.copytree(source, destination, symlinks=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))


def verify_models(models, lock):
    for row in json.loads(lock.read_text())['files']:
        relative = Path(row['file'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Unsafe model path in lockfile')
        path = models / relative
        if not path.is_file() or path.stat().st_size != row['bytes']:
            raise ValueError(f'Missing or incorrectly sized model: {relative}')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != row['sha256']:
            raise ValueError(f'Model checksum mismatch: {relative}')


def rewrite_config(value, sources):
    if isinstance(value, dict):
        return {key: rewrite_config(child, sources) for key, child in value.items()}
    if isinstance(value, list):
        return [rewrite_config(child, sources) for child in value]
    if isinstance(value, str) and value.startswith('/'):
        source = Path(value)
        for prefix, target in sources:
            if source == prefix or prefix in source.parents:
                return '@BUNDLE@/' + str(target / source.relative_to(prefix))
        raise ValueError('Configured absolute path is outside the bundle inputs')
    return value


def build(args):
    destination = args.output.resolve()
    if destination.exists():
        raise ValueError('Bundle output already exists')
    root = Path(__file__).resolve().parents[2]
    lock = root / 'tools/analysis-worker/models.lock.json'
    verify_models(args.models, lock)
    original = json.loads(args.config.read_text())
    ffmpeg = args.ffmpeg or Path(original['ffmpeg'])
    configured_enhanced = Path(original['python']).parent.parent
    adapter = original.get('semanticPhrases', {}).get('adapter')
    configured_worker = Path(adapter).parents[1] if adapter else args.worker
    sources = [(args.enhanced, Path('envs/enhanced')),
               (configured_enhanced, Path('envs/enhanced')),
               (args.dbn, Path('envs/dbn')),
               (args.key, Path('envs/key')),
               (args.models, Path('models')),
               (args.worker, Path('worker')),
               (configured_worker, Path('worker')),
               (ffmpeg, Path('bin/ffmpeg'))]
    config = rewrite_config(original, sources)
    with tempfile.TemporaryDirectory(prefix='resonance-enhanced-', dir=destination.parent) as temporary:
        stage = Path(temporary) / 'bundle'
        stage.mkdir()
        for name, path in [('enhanced', args.enhanced), ('dbn', args.dbn), ('key', args.key)]:
            copy_directory(path, stage / 'envs' / name)
        for name, path in [('3.12', args.python312), ('3.14', args.python314)]:
            copy_directory(path, stage / 'pythons' / name)
        copy_directory(args.worker, stage / 'worker')
        copy_directory(args.models, stage / 'models')
        (stage / 'bin').mkdir()
        shutil.copy2(ffmpeg, stage / 'bin/ffmpeg')
        shutil.copy2(lock, stage / 'models.lock.json')
        (stage / 'config.template.json').write_text(json.dumps(config, indent=2) + '\n')
        (stage / 'bundle.json').write_text(json.dumps({'schemaVersion': 1, 'platform': 'linux-x86_64'}, indent=2) + '\n')
        stage.rename(destination)
    print('Verified enhanced-analysis bundle built.')


def install(args):
    source = args.bundle.resolve()
    if json.loads((source / 'bundle.json').read_text()) != {'schemaVersion': 1, 'platform': 'linux-x86_64'}:
        raise ValueError('Unsupported bundle')
    verify_models(source / 'models', source / 'models.lock.json')
    root = args.app_dir.resolve() / 'data' / 'enhanced-analysis'
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.install-', dir=root) as temporary:
        stage = Path(temporary) / 'runtime'
        copy_directory(source, stage)
        target = root / ('runtime-' + uuid.uuid4().hex[:12])
        stage.rename(target)
        try:
            for name, version in [('enhanced', '3.12'), ('dbn', '3.12'), ('key', '3.14')]:
                venv = target / 'envs' / name
                base = target / 'pythons' / version
                executable = base / 'bin' / ('python' + version)
                if not executable.is_file():
                    raise ValueError('Bundled Python executable is missing')
                link = venv / 'bin/python'
                link.unlink()
                link.symlink_to(os.path.relpath(executable, link.parent))
                for alias in ('python3', 'python' + version):
                    alias_link = venv / 'bin' / alias
                    if alias_link.exists() or alias_link.is_symlink():
                        alias_link.unlink()
                    alias_link.symlink_to('python')
                (venv / 'pyvenv.cfg').write_text(
                    f'home = {base / "bin"}\ninclude-system-site-packages = false\n'
                    f'version = {version}\nexecutable = {executable}\n')
            template = (target / 'config.template.json').read_text()
            (target / 'config.json').write_text(template.replace('@BUNDLE@', str(root / 'current')))
            for name, module in [('enhanced', 'torch'), ('dbn', 'madmom'), ('key', 'essentia')]:
                subprocess.run([str(target / 'envs' / name / 'bin/python'), '-c', f'import {module}'],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
            if not (target / 'worker/analyze_track.py').is_file():
                raise ValueError('Bundled worker is missing')
        except Exception:
            shutil.rmtree(target)
            raise
        next_link = root / '.current-next'
        next_link.symlink_to(target.name)
        os.replace(next_link, root / 'current')
    print('Enhanced analysis installed inside Resonance application data.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build_parser = commands.add_parser('build')
    for name in ('output', 'enhanced', 'dbn', 'key', 'python312', 'python314', 'models', 'worker', 'config'):
        build_parser.add_argument('--' + name, type=Path, required=True)
    build_parser.add_argument('--ffmpeg', type=Path)
    install_parser = commands.add_parser('install')
    install_parser.add_argument('--bundle', type=Path, required=True)
    install_parser.add_argument('--app-dir', type=Path, required=True)
    args = parser.parse_args()
    build(args) if args.command == 'build' else install(args)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(f'Enhanced bundle failed: {error}') from error
