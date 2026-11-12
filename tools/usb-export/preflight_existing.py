"""Inspect USB player databases on Resonance before Bridge writes any audio.

Only database files and small Resonance export records are supplied by Bridge.
Track audio stays on the USB; Bridge checks the returned paths locally.
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from rekordbox_pdb import Database

from merge_existing import _read_one
from onelibrary_writer import _dependencies


def _name(value):
    return unicodedata.normalize('NFKC', str(value or '')).strip().casefold()


def _audio_files(manifest):
    files = manifest.get('files')
    if not isinstance(files, list):
        raise ValueError('USB export record has no file inventory')
    for item in files:
        if not isinstance(item, dict):
            raise ValueError('USB export record has an invalid file entry')
        path, digest = item.get('path'), item.get('sha256')
        if isinstance(path, str) and path.startswith('Contents/'):
            if not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None:
                raise ValueError('USB export record has an invalid audio checksum')
            yield ('/' + path).casefold(), digest


def inspect(existing: Path, prepared: Path, records: list):
    old = Database.from_file(existing / 'export.pdb')
    dbapi, _, _, key = _dependencies()
    modern = _read_one(dbapi, existing / 'exportLibrary.db', key)
    try:
        if modern.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Existing OneLibrary database failed its integrity check')
        classic_paths = {track.file_path for track in old.tracks}
        modern_paths = {row[0] for row in modern.execute('SELECT path FROM content')}
        if any(not isinstance(path, str) or not path for path in classic_paths | modern_paths):
            raise ValueError('Existing player database has an invalid audio path')
        candidate = json.loads(prepared.read_text())
        new_name = _name(candidate.get('playlistName'))
        if not new_name:
            raise ValueError('Prepared export has no playlist name')
        old_names = {_name(playlist.name) for playlist in old.playlist_tree if not playlist.is_folder}
        old_names.update(_name(row[0]) for row in modern.execute('SELECT name FROM playlist'))
        if new_name in old_names:
            raise ValueError('A playlist with this name already exists on the USB. Choose another name in Resonance before exporting.')
        old_paths = {path.casefold() for path in classic_paths | modern_paths}
        old_hashes = set()
        if not isinstance(records, list):
            raise ValueError('USB export records must be a list')
        for record in records:
            if not isinstance(record, dict) or record.get('schemaVersion') != 1:
                raise ValueError('USB export record is invalid')
            old_hashes.update(digest for path, digest in _audio_files(record) if path in old_paths)
        candidate_hashes = {digest for _, digest in _audio_files(candidate)}
        overlap = candidate_hashes & old_hashes
        if overlap:
            raise ValueError(f'{len(overlap)} track(s) in this export are already recorded on the USB. Remove them from the new set before exporting.')
        paths = sorted(classic_paths | modern_paths)
        if (len(paths) > 100000 or any(len(path) > 4096 for path in paths)
                or sum(len(path.encode('utf-8')) for path in paths) > (16 << 20)):
            raise ValueError('USB library track inventory is too large to check safely')
        return {'audioPaths': paths, 'existingTracks': len(paths), 'recordedTrackHashes': len(old_hashes)}
    finally:
        modern.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--existing', type=Path, required=True)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--records', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.existing, args.prepared, json.loads(args.records.read_text()))))
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
