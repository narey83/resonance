"""Persist the verified interpreter through the existing administrator settings API."""
import argparse
import copy
import datetime
import ipaddress
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import yaml


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Refusing to forward administrator authorization through a redirect')


def validate_url(base_url):
    parsed = urlsplit(base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError('Use the server base URL without credentials, query or fragment')
    if parsed.scheme == 'https':
        return
    try:
        loopback = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        loopback = False
    if parsed.scheme != 'http' or not loopback:
        raise ValueError('Use HTTPS, or HTTP on loopback through SSH')


def updated_document(original, python):
    document = yaml.safe_load(original) or {}
    if not isinstance(document, dict):
        raise ValueError('Server settings must be a YAML mapping')
    updated = copy.deepcopy(document)
    if updated.get('analysis') is None:
        updated['analysis'] = {}
    if not isinstance(updated['analysis'], dict):
        raise ValueError('The analysis settings must be a mapping')
    updated['analysis']['essentia_python'] = str(python)
    return updated


def configure(api, python, backup_directory):
    original = api('options/yaml')
    updated = updated_document(original, python)
    if yaml.safe_load(original) == updated:
        if api('options').get('analysis', {}).get('essentiaPython') != str(python):
            raise RuntimeError('Saved interpreter differs from the running configuration')
        return False
    new_yaml = yaml.safe_dump(updated, sort_keys=False, allow_unicode=True)
    if api('options/yaml/validate', 'POST', new_yaml) not in (None, ''):
        raise RuntimeError('Server rejected the analysis configuration; no settings changed')
    if api('options/yaml') != original:
        raise RuntimeError('Settings changed during validation; retry without overwriting them')
    backup_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if backup_directory.stat().st_mode & 0o077:
        raise ValueError('Settings backup directory must be private (mode 700)')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = backup_directory / ('before-native-analysis-' + stamp + '.yml')
    with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        stream.write(original)
    api('options/yaml', 'PUT', new_yaml)
    current = api('options')
    if current.get('analysis', {}).get('essentiaPython') != str(python):
        raise RuntimeError('The running server did not adopt the interpreter; private backup retained')
    if yaml.safe_load(api('options/yaml')) != updated:
        raise RuntimeError('Saved settings differ from the requested change; private backup retained')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--session-file', type=Path, required=True)
    parser.add_argument('--backup-directory', type=Path, required=True)
    args = parser.parse_args()
    validate_url(args.base_url)
    if args.session_file.stat().st_mode & 0o077:
        raise ValueError('The existing administrator session file must be private (mode 600)')
    token = json.loads(args.session_file.read_text())['token']
    opener = build_opener(NoRedirect())

    def api(path, method='GET', body=None):
        request = Request(args.base_url.rstrip('/') + '/api/v0/' + path, method=method,
                          headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                          data=None if body is None else json.dumps(body).encode())
        try:
            with opener.open(request, timeout=30) as response:
                content = response.read()
                return json.loads(content) if content else None
        except HTTPError as error:
            raise RuntimeError(f'Server rejected {method} {path} (HTTP {error.code})') from None

    changed = configure(api, args.python, args.backup_directory)
    print('Verified detector path saved; backend restart not required' if changed
          else 'Detector path already saved; settings unchanged')


if __name__ == '__main__':
    main()
