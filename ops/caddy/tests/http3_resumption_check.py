"""Reproduce a proxy header-limit change without unsafe HTTP/3 early data."""
import base64
import hashlib
import json
import os
import pathlib
import subprocess

from fixture import ROOT, SiteFixture


def main():
    fixture = SiteFixture(pathlib.Path(os.environ['CADDY_BIN']).resolve(), tls=True)
    try:
        public_key = subprocess.run(
            ['openssl', 'x509', '-in', str(fixture.cert), '-pubkey', '-noout'],
            check=True, capture_output=True,
        ).stdout
        der = subprocess.run(
            ['openssl', 'pkey', '-pubin', '-outform', 'DER'],
            input=public_key, check=True, capture_output=True,
        ).stdout
        pin = base64.b64encode(hashlib.sha256(der).digest()).decode()
        environment = dict(os.environ, HTTP3_RESUMPTION_FIXTURE=json.dumps({
            'origin': fixture.origin, 'admin': fixture.admin, 'pin': pin,
            'netlog': str(fixture.root / 'netlog.json'),
        }))
        subprocess.run(
            ['node', str(ROOT / 'ops/caddy/tests/http3_resumption_check.mjs')],
            env=environment, check=True, timeout=120,
        )
    finally:
        fixture.close()


if __name__ == '__main__':
    main()
