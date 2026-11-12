"""Edit copies of both USB player databases for a Bridge deletion.

The mounted USB is never opened here. The caller verifies and commits the returned
databases and file plan as one recoverable operation.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path, PurePosixPath

from rekordbox_pdb import Database, TableType
from rekordbox_pdb.edit import PdbEditor

from merge_existing import _read_one
from onelibrary_writer import _connect, _dependencies


def _usb_file(value, prefix):
    path = PurePosixPath(str(value))
    if (not str(value).startswith('/') or '\\' in str(value) or '..' in path.parts
            or not str(path).startswith(prefix) or path == PurePosixPath(prefix)):
        raise ValueError('Player database contains an unsafe file path')
    return str(path)


def _delete_rows(editor, table, predicate):
    """Clear PDB row presence bits, preserving unknown rows and all other bytes."""
    rows = list(editor.db.rows(table))
    locations = list(editor.db.row_locations(table))
    if len(rows) != len(locations):
        raise ValueError('Classic database row locations are incomplete')
    deleted = 0
    for row, location in zip(rows, locations):
        if not predicate(row):
            continue
        page_index, row_offset = divmod(location, editor.page_size)
        page = page_index * editor.page_size
        slots = editor._slot_count(page)
        matches = []
        for slot in range(slots):
            group, bit = divmod(slot, 16)
            base = page + editor.page_size - group * 0x24
            if (editor._u16(base - 4) & (1 << bit)
                    and editor._u16(base - 6 - 2 * bit) + 0x28 == row_offset):
                matches.append((base, bit))
        if len(matches) != 1:
            raise ValueError('Classic database row could not be located uniquely')
        base, bit = matches[0]
        editor._put(base - 4, '<H', editor._u16(base - 4) & ~(1 << bit))
        present = editor._present_count(page, slots)
        editor._put(page + 0x19, '<H', 0x20 * present | (1 if slots > 255 else 0))
        editor._mark_table_touched(table, page_index)
        deleted += 1
    editor._db = None
    return deleted


def _delete_ids(connection, table, column, ids):
    identifiers = sorted(set(ids))
    for start in range(0, len(identifiers), 500):
        part = identifiers[start:start + 500]
        connection.execute(
            f'DELETE FROM "{table}" WHERE "{column}" IN (' + ','.join('?' for _ in part) + ')', part)


def _modern_playlist(connection, name, paths):
    candidates = []
    for playlist_id, candidate_name in connection.execute('SELECT playlist_id,name FROM playlist'):
        if candidate_name != name:
            continue
        entries = [row[0] for row in connection.execute(
            'SELECT c.path FROM playlist_content pc JOIN content c ON c.content_id=pc.content_id '
            'WHERE pc.playlist_id=? ORDER BY pc.sequenceNo', (playlist_id,))]
        if entries == paths:
            candidates.append(playlist_id)
    if len(candidates) != 1:
        raise ValueError('Classic and OneLibrary playlist entries do not match uniquely')
    return candidates[0]


def edit(existing, destination, kind, target_id):
    existing, destination = Path(existing), Path(destination)
    if destination.exists():
        raise FileExistsError('Edited output must be a new directory')
    classic_path, modern_path = existing / 'export.pdb', existing / 'exportLibrary.db'
    if any(not path.is_file() or path.is_symlink() for path in (classic_path, modern_path)):
        raise ValueError('Both classic and OneLibrary databases are required')
    before = Database.from_file(classic_path)
    tracks = {track.id: track for track in before.tracks}
    if len(tracks) != len(before.tracks):
        raise ValueError('Classic database has duplicate track IDs')
    classic_paths = [_usb_file(t.file_path, '/Contents/') for t in before.tracks]
    if len(set(classic_paths)) != len(classic_paths):
        raise ValueError('Classic database has duplicate track file paths')
    if kind == 'track':
        if target_id not in tracks:
            raise ValueError('Track is no longer on the USB')
        playlist_id = None
        deleted_ids = {target_id}
    elif kind == 'playlist':
        playlist = next((item for item in before.playlist_tree if item.id == target_id), None)
        if playlist is None or playlist.is_folder:
            raise ValueError('Playlist is no longer on the USB')
        if any(item.parent_id == target_id for item in before.playlist_tree):
            raise ValueError('Playlist contains child folders or playlists')
        playlist_id = target_id
        selected = [entry for entry in before.playlist_entries if entry.playlist_id == target_id]
        if any(entry.track_id not in tracks for entry in selected):
            raise ValueError('Playlist references a missing classic track')
        other_ids = {entry.track_id for entry in before.playlist_entries if entry.playlist_id != target_id}
        deleted_ids = {entry.track_id for entry in selected} - other_ids
    else:
        raise ValueError('Unsupported USB edit')

    dbapi, _, _, key = _dependencies()
    modern = _read_one(dbapi, modern_path, key)
    try:
        if modern.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('OneLibrary database failed its integrity check')
        existing_broken_references = set(modern.execute('PRAGMA foreign_key_check').fetchall())
        content = modern.execute('SELECT content_id,path,analysisDataFilePath FROM content').fetchall()
        modern_by_path = {path: (content_id, analysis) for content_id, path, analysis in content}
        if len(modern_by_path) != len(content) or set(modern_by_path) != set(classic_paths):
            raise ValueError('Classic and OneLibrary track catalogs differ')
        for track in before.tracks:
            if track.analyze_path != modern_by_path[track.file_path][1]:
                raise ValueError('Classic and OneLibrary analysis paths differ')
        modern_playlist_id = None
        if playlist_id is not None:
            selected_paths = [tracks[e.track_id].file_path for e in sorted(
                (entry for entry in before.playlist_entries if entry.playlist_id == playlist_id),
                key=lambda entry: entry.entry_index)]
            modern_playlist_id = _modern_playlist(modern, playlist.name, selected_paths)
            other_modern_ids = {row[0] for row in modern.execute(
                'SELECT content_id FROM playlist_content WHERE playlist_id<>?', (modern_playlist_id,))}
            deleted_ids = {id for id in deleted_ids if modern_by_path[tracks[id].file_path][0] not in other_modern_ids}
        removed_content_ids = {modern_by_path[tracks[id].file_path][0] for id in deleted_ids}
        if removed_content_ids:
            if any((master_id in removed_content_ids or link_id in removed_content_ids)
                   for content_id, master_id, link_id in modern.execute(
                       'SELECT content_id,masterContentId,contentLink FROM content')
                   if content_id not in removed_content_ids):
                raise ValueError('A remaining OneLibrary track links to the selected track')
        remaining = [track for track in before.tracks if track.id not in deleted_ids]
        remaining_audio = {track.file_path for track in remaining}
        remaining_analysis = {track.analyze_path for track in remaining}
        files = set()
        for id in deleted_ids:
            track = tracks[id]
            if track.file_path not in remaining_audio:
                files.add(_usb_file(track.file_path, '/Contents/'))
            if track.analyze_path not in remaining_analysis:
                files.add(_usb_file(track.analyze_path, '/PIONEER/USBANLZ/'))
        plan = {'kind': kind, 'targetId': target_id, 'deletedTrackIds': sorted(deleted_ids),
                'deletedPlaylistIds': [playlist_id] if playlist_id is not None else [],
                'removedFiles': sorted(files)}
    finally:
        modern.close()

    destination.mkdir(mode=0o700)
    try:
        editor = PdbEditor.from_file(classic_path)
        _delete_rows(editor, TableType.PLAYLIST_ENTRIES,
                     lambda row: row.track_id in deleted_ids or row.playlist_id == playlist_id)
        _delete_rows(editor, TableType.HISTORY_ENTRIES, lambda row: row.track_id in deleted_ids)
        _delete_rows(editor, TableType.TRACKS, lambda row: row.id in deleted_ids)
        if playlist_id is not None:
            if _delete_rows(editor, TableType.PLAYLIST_TREE, lambda row: row.id == playlist_id) != 1:
                raise ValueError('Classic playlist deletion was incomplete')
        editor.save(destination / 'export.pdb')
        classic_after = Database.from_file(destination / 'export.pdb')
        if {t.id for t in classic_after.tracks} != set(tracks) - deleted_ids:
            raise ValueError('Classic track deletion failed readback')
        if playlist_id is not None and any(p.id == playlist_id for p in classic_after.playlist_tree):
            raise ValueError('Classic playlist deletion failed readback')
        if any(e.track_id in deleted_ids or e.playlist_id == playlist_id for e in classic_after.playlist_entries):
            raise ValueError('Classic playlist references a deleted item')

        shutil.copyfile(modern_path, destination / 'exportLibrary.db')
        updated = _connect(dbapi, destination / 'exportLibrary.db', key)
        try:
            if updated.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('OneLibrary copy failed its integrity check')
            updated.execute('BEGIN IMMEDIATE')
            if modern_playlist_id is not None:
                if updated.execute('SELECT count(*) FROM playlist WHERE playlist_id_parent=?',
                                   (modern_playlist_id,)).fetchone()[0]:
                    raise ValueError('OneLibrary playlist has children')
                updated.execute('DELETE FROM playlist_content WHERE playlist_id=?', (modern_playlist_id,))
                updated.execute('DELETE FROM playlist WHERE playlist_id=?', (modern_playlist_id,))
            for table in ('playlist_content', 'cue', 'history_content', 'myTag_content'):
                _delete_ids(updated, table, 'content_id', removed_content_ids)
            for column in ('content_id_1', 'content_id_2'):
                _delete_ids(updated, 'recommendedLike', column, removed_content_ids)
            _delete_ids(updated, 'content', 'content_id', removed_content_ids)
            updated.execute('UPDATE property SET numberOfContents=(SELECT count(*) FROM content)')
            updated.commit()
            if updated.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Edited OneLibrary failed its integrity check')
            if set(updated.execute('PRAGMA foreign_key_check').fetchall()) - existing_broken_references:
                raise ValueError('Edited OneLibrary has new broken references')
            if {row[0] for row in updated.execute('SELECT path FROM content')} != {t.file_path for t in classic_after.tracks}:
                raise ValueError('Edited player databases disagree on remaining tracks')
            if modern_playlist_id is not None and updated.execute(
                    'SELECT count(*) FROM playlist WHERE playlist_id=?', (modern_playlist_id,)).fetchone()[0]:
                raise ValueError('OneLibrary playlist deletion failed readback')
        finally:
            updated.close()
        (destination / 'plan.json').write_text(json.dumps(plan, separators=(',', ':')))
        return plan
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--existing', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--kind', choices=('track', 'playlist'), required=True)
    parser.add_argument('--target-id', type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(edit(args.existing, args.destination, args.kind, args.target_id)))
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
