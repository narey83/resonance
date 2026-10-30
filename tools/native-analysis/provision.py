#!/usr/bin/env python3
"""Install or check native BPM/key analysis. Never run a package manager at app startup."""
import argparse
import json
import math
from pathlib import Path
import platform
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SENTINEL = 'RESONANCE_NATIVE_ANALYSIS:'


def validate_probe(result, versions):
    bpm = result.get('bpm')
    if (not isinstance(bpm, (int, float)) or isinstance(bpm, bool)
            or not math.isfinite(bpm) or bpm <= 0
            or not isinstance(result.get('key'), str) or not result['key'].strip()
            or result.get('scale') not in ('major', 'minor')
            or not isinstance(result.get('beats'), int) or result['beats'] < 2):
        raise RuntimeError('Basic analysis is incomplete: BPM, key and detected beats are required')
    if result.get('packages') != versions:
        raise RuntimeError('Detector dependencies differ from the published native lockfile')


def check(python, runner=subprocess.run):
    versions = dict(re.findall(r'^([\w-]+)==([^\s]+)',
                               (HERE / 'requirements.txt').read_text(), re.MULTILINE))
    try:
        completed = runner([str(python), str(HERE / 'probe.py')], check=True,
                           capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError('BPM/key detector unavailable; run native analysis provisioning first') from error
    lines = [line[len(SENTINEL):] for line in completed.stdout.splitlines()
             if line.startswith(SENTINEL)]
    if len(lines) != 1:
        raise RuntimeError('BPM/key detector did not return a verified result')
    result = json.loads(lines[0])
    validate_probe(result, versions)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venv', type=Path, required=True, help='Persistent directory outside application releases')
    parser.add_argument('--check', action='store_true', help='Verify the existing environment without installing')
    parser.add_argument('--configure', action='store_true', help='Save the verified path in the running server settings')
    parser.add_argument('--base-url')
    parser.add_argument('--session-file', type=Path)
    args = parser.parse_args()
    if args.configure and (not args.base_url or not args.session_file):
        parser.error('--configure requires --base-url and a private --session-file')
    environment = args.venv.expanduser().absolute()
    python = environment / 'bin/python'
    if not args.check:
        if sys.version_info[:2] != (3, 14) or sys.platform != 'linux' or platform.machine() != 'x86_64':
            parser.error('This wheel lock targets Linux x86_64 with CPython 3.14; no global tools were changed')
        if environment.exists() and not (environment / 'pyvenv.cfg').is_file():
            parser.error('Refusing to overwrite a directory that is not a Python virtual environment')
        if not environment.exists():
            subprocess.run([sys.executable, '-m', 'venv', str(environment)], check=True)
        subprocess.run([str(python), '-m', 'pip', 'install', '--only-binary=:all:', '--require-hashes',
                        '-r', str(HERE / 'requirements.txt')], check=True)
    result = check(python)
    if args.configure:
        subprocess.run([str(python), str(HERE / 'configure.py'), '--python', str(python),
                        '--base-url', args.base_url, '--session-file', str(args.session_file),
                        '--backup-directory', str(environment.parent / 'private-config-backups')], check=True)
    print(json.dumps({'basicAnalysisReady': True, 'python': str(python), 'probe': result}))


if __name__ == '__main__':
    main()
