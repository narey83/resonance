"""Read generated export databases without decoding audio or changing their files."""
from pathlib import Path
import hashlib
import json


def inspect_export(root):
    from rekordbox_pdb import Database
    root = Path(root)
    manifest = json.loads((root / 'export-manifest.json').read_text())
    database = Database.from_file(root / 'PIONEER/rekordbox/export.pdb')
    artists = {row.id: row.name for row in database.artists}
    albums = {row.id: row.name for row in database.albums}
    keys = {row.id: row.name for row in database.keys}
    tracks = [dict(id=row.id, title=row.title, artist=artists.get(row.artist_id, ''),
                   album=albums.get(row.album_id, ''), key=keys.get(row.key_id, ''),
                   bpm=row.tempo / 100, durationSeconds=row.duration,
                   sampleRate=row.sample_rate, bitDepth=row.sample_depth,
                   bytes=row.file_size, path=row.file_path, analysisPath=row.analyze_path)
              for row in database.tracks]
    playlists = [dict(id=row.id, name=row.name,
                      trackIds=[entry.track_id for entry in sorted(database.playlist_entries, key=lambda e: e.entry_index)
                                if entry.playlist_id == row.id])
                 for row in database.playlist_tree if not row.is_folder]
    files = []
    for spec in manifest['files']:
        if spec['path'] not in {'PIONEER/rekordbox/export.pdb', 'PIONEER/rekordbox/exportExt.pdb', 'PIONEER/rekordbox/exportLibrary.db'}:
            continue
        path = root / spec['path']
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append(dict(path=spec['path'], bytes=path.stat().st_size, sha256=digest,
                          matchesManifest=digest == spec['sha256'] and path.stat().st_size == spec['bytes']))
    one = None
    if manifest['profile'] == 'dual':
        from onelibrary_writer import _dependencies
        dbapi, _, _, key = _dependencies()
        path = root / 'PIONEER/rekordbox/exportLibrary.db'
        connection = dbapi.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            connection.execute("PRAGMA key='" + key.replace("'", "''") + "'")
            connection.execute('PRAGMA query_only=ON')
            integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
            rows = connection.execute('SELECT content_id,title,path FROM content ORDER BY content_id').fetchall()
            entries = connection.execute('SELECT playlist_id,content_id FROM playlist_content ORDER BY playlist_id,sequenceNo').fetchall()
            expected = sorted((t['id'], t['title'], t['path']) for t in tracks)
            expected_entries = sorted((p['id'], i, tid) for p in playlists for i, tid in enumerate(p['trackIds']))
            one = dict(tracks=len(rows), integrity=integrity,
                       tracksMatchLegacy=rows == expected,
                       playlistOrderMatchesLegacy=entries == [(pid, tid) for pid, _, tid in expected_entries])
        finally:
            connection.close()
    return dict(schemaVersion=1, source=manifest.get('source'), profile=manifest['profile'], playlistName=manifest['playlistName'],
                audioPolicy=manifest.get('audioPolicy', ''), totalBytes=sum(f['bytes'] for f in manifest['files']),
                fileCount=len(manifest['files']), tracks=tracks, playlists=playlists, databases=files,
                oneLibrary=one, hardwareVerified=False)


def write_inspection(root, output):
    report = inspect_export(root)
    output = Path(output)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    temporary.replace(output)
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    write_inspection(args.root, args.output)
