"""Merge a prepared Resonance set into COPIES of both existing player databases.

The caller must stage audio and analysis separately and publish these resulting
databases only after every new file has been verified on the destination USB.
Neither input database is modified.
"""

from collections import Counter
from pathlib import Path
import argparse
import shutil
from urllib.parse import quote

from rekordbox_pdb import Database
from rekordbox_pdb.edit import PdbEditor

from onelibrary_writer import _connect, _dependencies


def _read_one(dbapi, path, key):
    uri = 'file:' + quote(str(Path(path).resolve())) + '?mode=ro'
    connection = dbapi.connect(uri, uri=True)
    connection.execute("PRAGMA key='" + key.replace("'", "''") + "'")
    return connection


def _names(rows):
    return {row.id: row.name for row in rows}


def _snapshot_classic(db):
    return {
        'tracks': [(t.id, t.title, t.file_path, t.analyze_path) for t in db.tracks],
        'playlists': [(p.id, p.name, p.parent_id, p.sort_order) for p in db.playlist_tree],
        'entries': [(e.playlist_id, e.track_id, e.entry_index) for e in db.playlist_entries],
        'history': [(e.id, e.name) for e in db.history_playlists],
        'history_entries': [(e.playlist_id, e.track_id, e.entry_index) for e in db.history_entries],
    }


def _merge_classic(existing, prepared, destination, playlist_name):
    before = Database.from_file(existing)
    source = Database.from_file(prepared)
    if not source.tracks or len(source.playlist_tree) != 1:
        raise ValueError('Prepared classic export has no single set playlist')
    if any(p.is_folder for p in source.playlist_tree):
        raise ValueError('Prepared set contains unexpected playlist folders')
    old = _snapshot_classic(before)
    old_paths = {t.file_path.casefold() for t in before.tracks}
    old_analysis = {t.analyze_path.casefold() for t in before.tracks}
    if any(t.file_path.casefold() in old_paths or t.analyze_path.casefold() in old_analysis for t in source.tracks):
        raise ValueError('Prepared set collides with an existing track or analysis path')
    lookup = {name: _names(getattr(source, name)) for name in ('artists', 'albums', 'genres', 'keys', 'labels')}
    editor = PdbEditor.from_file(existing)
    mapped = {}
    for track in source.tracks:
        mapped[track.id] = editor.add_track(
            title=track.title, file_path=track.file_path, filename=track.filename,
            artist=lookup['artists'].get(track.artist_id),
            album=lookup['albums'].get(track.album_id),
            genre=lookup['genres'].get(track.genre_id),
            key=lookup['keys'].get(track.key_id),
            label=lookup['labels'].get(track.label_id),
            comment=track.comment, mix_name=track.mix_name,
            release_date=track.release_date, analyze_path=track.analyze_path,
            date_added=track.date_added, tempo=track.tempo,
            duration=track.duration, year=track.year, bitrate=track.bitrate,
            sample_rate=track.sample_rate, sample_depth=track.sample_depth,
            file_size=track.file_size, track_number=track.track_number,
            disc_number=track.disc_number, play_count=track.play_count,
            rating=track.rating, color_id=track.color_id,
            artwork_id=track.artwork_id,
        )
    playlist = editor.create_playlist(playlist_name)
    entries = sorted(source.playlist_entries, key=lambda e: e.entry_index)
    if len(entries) != len(source.tracks) or {e.track_id for e in entries} != set(mapped):
        raise ValueError('Prepared set playlist does not match its tracks')
    for entry in entries:
        editor.add_to_playlist(playlist, mapped[entry.track_id])
    editor.save(destination)
    after = Database.from_file(destination)
    if any(Counter(_snapshot_classic(after)[key]) & Counter(rows) != Counter(rows) for key, rows in old.items()):
        raise ValueError('Existing classic library rows changed')
    if len(after.tracks) != len(before.tracks) + len(source.tracks):
        raise ValueError('Merged classic track count is wrong')
    return mapped


def _columns(connection, table):
    return [row[1] for row in connection.execute('PRAGMA table_info("' + table + '")')]


def _rows(connection, table):
    cols = _columns(connection, table)
    if not cols:
        raise ValueError('Missing OneLibrary table: ' + table)
    return cols, connection.execute('SELECT * FROM "' + table + '"').fetchall()


def _insert(connection, table, columns, values):
    names = ','.join('"' + name + '"' for name in columns)
    marks = ','.join('?' for _ in columns)
    connection.execute('INSERT INTO "' + table + '" (' + names + ') VALUES (' + marks + ')', values)


def _merge_one(existing, prepared, destination, playlist_name):
    dbapi, _, _, key = _dependencies()
    shutil.copyfile(existing, destination)
    source = _read_one(dbapi, prepared, key)
    target = _connect(dbapi, destination, key)
    try:
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('OneLibrary integrity check failed before merge')
        required = ('content', 'playlist', 'playlist_content', 'cue', 'artist', 'album', 'genre', 'key', 'property')
        if any([name.casefold() for name in _columns(source, table)] != [name.casefold() for name in _columns(target, table)] for table in required):
            raise ValueError('Existing OneLibrary schema differs from the prepared set')
        old = {table: _rows(target, table)[1] for table in required if table != 'property'}
        source_contents = _rows(source, 'content')[1]
        if not source_contents:
            raise ValueError('Prepared OneLibrary has no tracks')
        s_cols = _columns(source, 'content')
        c_id = s_cols.index('content_id')
        c_path = s_cols.index('path')
        c_anlz = s_cols.index('analysisDataFilePath')
        old_paths = {str(row[c_path]).casefold() for row in old['content']}
        old_anlz = {str(row[c_anlz]).casefold() for row in old['content']}
        if any(str(row[c_path]).casefold() in old_paths or str(row[c_anlz]).casefold() in old_anlz for row in source_contents):
            raise ValueError('Prepared OneLibrary track or analysis path already exists')
        if len(_rows(source, 'playlist')[1]) != 1:
            raise ValueError('Prepared OneLibrary needs exactly one playlist')
        target.execute('BEGIN IMMEDIATE')
        lookup = {}
        for table in ('artist', 'album', 'genre', 'key'):
            cols, fresh = _rows(source, table)
            existing_rows = _rows(target, table)[1]
            identifier = table + '_id'
            id_pos = cols.index(identifier)
            name_pos = cols.index('name')
            next_id = max((int(row[id_pos]) for row in existing_rows), default=0)
            known = {str(row[name_pos]): int(row[id_pos]) for row in existing_rows}
            lookup[table] = {}
            for row in fresh:
                name = str(row[name_pos])
                if name not in known:
                    next_id += 1
                    values = list(row)
                    values[id_pos] = next_id
                    if table == 'album' and 'artist_id' in cols:
                        values[cols.index('artist_id')] = lookup['artist'].get(values[cols.index('artist_id')], 0)
                    _insert(target, table, cols, values)
                    known[name] = next_id
                lookup[table][int(row[id_pos])] = known[name]
        next_content = max((int(row[c_id]) for row in old['content']), default=0)
        mapped = {}
        for row in source_contents:
            next_content += 1
            values = list(row)
            mapped[int(row[c_id])] = next_content
            values[c_id] = next_content
            for table, column in (('artist', 'artist_id_artist'), ('artist', 'artist_id_remixer'), ('artist', 'artist_id_originalArtist'), ('artist', 'artist_id_composer'), ('artist', 'artist_id_lyricist'), ('album', 'album_id'), ('genre', 'genre_id'), ('key', 'key_id')):
                pos = s_cols.index(column)
                if values[pos] not in (None, 0):
                    values[pos] = lookup[table].get(int(values[pos]), 0)
            _insert(target, 'content', s_cols, values)
        p_cols, playlists = _rows(source, 'playlist')
        old_p_cols = _columns(target, 'playlist')
        p_id = p_cols.index('playlist_id')
        new_playlist = max((int(row[p_id]) for row in old['playlist']), default=0) + 1
        item = list(playlists[0])
        item[p_id] = new_playlist
        item[p_cols.index('name')] = playlist_name
        item[p_cols.index('sequenceNo')] = max((int(row[old_p_cols.index('sequenceNo')]) for row in old['playlist'] if int(row[old_p_cols.index('playlist_id_parent')] or 0) == 0), default=0) + 1
        _insert(target, 'playlist', p_cols, item)
        pc_cols, entries = _rows(source, 'playlist_content')
        if len(entries) != len(source_contents):
            raise ValueError('Prepared OneLibrary playlist does not match its tracks')
        for entry in entries:
            values = list(entry)
            values[pc_cols.index('playlist_id')] = new_playlist
            values[pc_cols.index('content_id')] = mapped[int(values[pc_cols.index('content_id')])]
            _insert(target, 'playlist_content', pc_cols, values)
        cue_cols, cues = _rows(source, 'cue')
        next_cue = max((int(row[cue_cols.index('cue_id')]) for row in old['cue']), default=0)
        for cue in cues:
            next_cue += 1
            values = list(cue)
            values[cue_cols.index('cue_id')] = next_cue
            values[cue_cols.index('content_id')] = mapped[int(values[cue_cols.index('content_id')])]
            _insert(target, 'cue', cue_cols, values)
        target.execute('UPDATE property SET numberOfContents=?', (len(old['content']) + len(source_contents),))
        target.commit()
        if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Merged OneLibrary integrity check failed')
        for table, rows in old.items():
            if Counter(_rows(target, table)[1]) & Counter(rows) != Counter(rows):
                raise ValueError('Existing OneLibrary rows changed: ' + table)
        if target.execute('SELECT count(*) FROM content').fetchone()[0] != len(old['content']) + len(source_contents):
            raise ValueError('Merged OneLibrary track count is wrong')
        return mapped
    finally:
        source.close()
        target.close()


def merge(existing: Path, prepared: Path, destination: Path, playlist_name: str):
    existing, prepared, destination = map(Path, (existing, prepared, destination))
    if destination.exists():
        raise FileExistsError('Merged output must be a new directory')
    for root in (existing, prepared):
        for name in ('export.pdb', 'exportLibrary.db'):
            path = root / name
            if not path.is_file() or path.is_symlink():
                raise ValueError('Both classic and OneLibrary database files are required')
    destination.mkdir(mode=0o700)
    try:
        classic_paths = {track.file_path for track in Database.from_file(prepared / 'export.pdb').tracks}
        dbapi, _, _, key = _dependencies()
        modern_source = _read_one(dbapi, prepared / 'exportLibrary.db', key)
        try:
            modern_paths = {row[0] for row in modern_source.execute('SELECT path FROM content')}
        finally:
            modern_source.close()
        if classic_paths != modern_paths:
            raise ValueError('Prepared classic and OneLibrary tracks disagree')
        classic = _merge_classic(existing / 'export.pdb', prepared / 'export.pdb', destination / 'export.pdb', playlist_name)
        modern = _merge_one(existing / 'exportLibrary.db', prepared / 'exportLibrary.db', destination / 'exportLibrary.db', playlist_name)
        if len(classic) != len(modern):
            raise ValueError('Merged database track counts disagree')
        return {'addedTracks': len(classic), 'classicTracks': len(Database.from_file(destination / 'export.pdb').tracks)}
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--existing', type=Path, required=True)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--playlist-name', required=True)
    args = parser.parse_args()
    print(merge(args.existing, args.prepared, args.destination, args.playlist_name))
