#!/usr/bin/env python3
"""Build only the Bridge export tools. No live data, credentials or model files enter the context."""
from pathlib import Path
import argparse, shutil, subprocess, tempfile
parser=argparse.ArgumentParser();parser.add_argument('--tag',default='resonance-backend-dev:bridge-worker');parser.add_argument('--base',default='resonance-backend-dev:integrated-tools');args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='bridge-worker-build-') as directory:
 context=Path(directory);(context/'tools').mkdir()
 shutil.copytree(root/'tools/usb-export',context/'tools/usb-export',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 shutil.copy2(root/'docker/bridge-worker.Dockerfile',context/'Dockerfile')
 subprocess.run(['docker','build','--build-arg','BASE_IMAGE='+args.base,'--tag',args.tag,str(context)],check=True)
