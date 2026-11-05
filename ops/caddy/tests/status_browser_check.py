"""Check standalone status pages through real Caddy, without an app build."""
import json
import os
import pathlib
import subprocess

from fixture import ROOT, SiteFixture


def main():
    fixture = SiteFixture(pathlib.Path(os.environ['CADDY_BIN']).resolve())
    try:
        fixture.set_mode('unavailable')
        environment = dict(os.environ, STATUS_BROWSER_FIXTURE=json.dumps({
            'origin': fixture.origin, 'mode': str(fixture.mode),
        }))
        subprocess.run(['node', str(ROOT / 'ops/caddy/tests/status_browser_check.mjs')],
                       env=environment, check=True, timeout=120)
    finally:
        fixture.close()


if __name__ == '__main__':
    main()
