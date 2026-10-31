"""Check real TLS/HTTP2 media in Chromium across track changes and reloads."""
import json
import os
import pathlib
import subprocess

from fixture import ROOT, SiteFixture


def main():
    fixture = SiteFixture(pathlib.Path(os.environ['CADDY_BIN']).resolve(), tls=True)
    try:
        environment = dict(os.environ, MEDIA_TRANSPORT_FIXTURE=json.dumps({
            'origin': fixture.origin, 'admin': fixture.admin,
        }))
        subprocess.run(['node', str(ROOT / 'ops/caddy/tests/media_transport_check.mjs')], env=environment, check=True, timeout=120)
    finally:
        fixture.close()


if __name__ == '__main__':
    main()
