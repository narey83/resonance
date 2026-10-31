"""Exercise the built React app and monitor through real, isolated Caddy."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile

from fixture import ROOT, SiteFixture


def main():
    caddy = pathlib.Path(os.environ['CADDY_BIN']).resolve()
    build = pathlib.Path(os.environ.get('FRONTEND_BUILD', ROOT / 'frontend/build')).resolve()
    with tempfile.TemporaryDirectory(prefix='resonance-browser-health-') as temporary:
        web = pathlib.Path(temporary) / 'web'
        shutil.copytree(build, web)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        fixture = SiteFixture(caddy, web, f'127.0.0.1:{port}')
        try:
            environment = dict(os.environ, HEALTH_BROWSER_FIXTURE=json.dumps({
                'origin': fixture.origin, 'probeOrigin': fixture.probe_origin,
                'healthPort': port, 'web': str(web), 'mode': str(fixture.mode),
            }))
            subprocess.run(['node', str(ROOT / 'ops/caddy/tests/browser_check.mjs')], env=environment, check=True, timeout=240)
        finally:
            fixture.close()


if __name__ == '__main__':
    main()
