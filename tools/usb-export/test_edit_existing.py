import tempfile
import unittest
from pathlib import Path

from rekordbox_pdb import Database
from rekordbox_pdb.edit import PdbEditor

from edit_existing import edit
from onelibrary_writer import _connect, _dependencies, write_onelibrary


def fixture(root, shared=False):
    existing = root / 'existing'
    dbdir = existing / 'PIONEER/rekordbox'
    dbdir.mkdir(parents=True)
    editor = PdbEditor((Path(__file__).parent / 'legacy-empty-template.pdb').read_bytes())
    ids = []
    tracks = []
    for number in (1, 2):
        audio = f'/Contents/Test/track-{number}.wav'
        analysis = f'/PIONEER/USBANLZ/Test/track-{number}/ANLZ0000.DAT'
        ids.append(editor.add_track(f'Track {number}', audio, analyze_path=analysis))
        tracks.append(dict(id=number, title=f'Track {number}', artist='', album='', genre='', key='', bpm=120,
                           durationSeconds=1, sampleRate=44100, bitRate=1411, bitDepth=16, fileBytes=176400,
                           usbPath=audio, anlzPath=analysis, cues=[]))
    playlist = editor.create_playlist('Set')
    for id in ids:
        editor.add_to_playlist(playlist, id)
    if shared:
        other = editor.create_playlist('Shared')
        editor.add_to_playlist(other, ids[1])
    editor.save(dbdir / 'export.pdb')
    write_onelibrary(existing, tracks, 'Set')
    if shared:
        dbapi, _, _, key = _dependencies()
        connection = _connect(dbapi, dbdir / 'exportLibrary.db', key)
        try:
            for table, replacements in (
                ('playlist', {'playlist_id': 2, 'name': 'Shared', 'sequenceNo': 2}),
                ('playlist_content', {'playlist_id': 2, 'content_id': 2, 'sequenceNo': 1}),
            ):
                columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
                row = list(connection.execute(f'SELECT * FROM "{table}" LIMIT 1').fetchone())
                for name, value in replacements.items():
                    row[columns.index(name)] = value
                names = ','.join('"' + name + '"' for name in columns)
                marks = ','.join('?' for _ in columns)
                connection.execute(f'INSERT INTO "{table}" ({names}) VALUES ({marks})', row)
            connection.commit()
        finally:
            connection.close()
    return dbdir, ids, playlist


class EditExistingTests(unittest.TestCase):
    def test_track_deletion_removes_catalog_and_playlist_references_from_both(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            existing, ids, _ = fixture(root, shared=True)
            result = root / 'result'
            plan = edit(existing, result, 'track', ids[1])
            self.assertEqual(plan['deletedTrackIds'], [ids[1]])
            self.assertEqual(len(plan['removedFiles']), 2)
            classic = Database.from_file(result / 'export.pdb')
            self.assertEqual([track.id for track in classic.tracks], [ids[0]])
            self.assertEqual([entry.track_id for entry in classic.playlist_entries], [ids[0]])
            dbapi, _, _, key = _dependencies()
            modern = _connect(dbapi, result / 'exportLibrary.db', key)
            try:
                self.assertEqual(modern.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(modern.execute('SELECT count(*) FROM content').fetchone()[0], 1)
                self.assertEqual(modern.execute('SELECT count(*) FROM playlist_content').fetchone()[0], 1)
                self.assertEqual(modern.execute('SELECT numberOfContents FROM property').fetchone()[0], 1)
            finally:
                modern.close()
            self.assertEqual(len(Database.from_file(existing / 'export.pdb').tracks), 2)

    def test_playlist_deletion_removes_only_exclusive_tracks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            existing, ids, playlist = fixture(root, shared=True)
            plan = edit(existing, root / 'result', 'playlist', playlist)
            self.assertEqual(plan['deletedTrackIds'], [ids[0]])
            self.assertEqual(plan['deletedPlaylistIds'], [playlist])
            classic = Database.from_file(root / 'result/export.pdb')
            self.assertEqual([track.id for track in classic.tracks], [ids[1]])
            self.assertEqual([item.name for item in classic.playlist_tree], ['Shared'])
            self.assertEqual([entry.track_id for entry in classic.playlist_entries], [ids[1]])
            dbapi, _, _, key = _dependencies()
            modern = _connect(dbapi, root / 'result/exportLibrary.db', key)
            try:
                self.assertEqual(modern.execute('SELECT title FROM content').fetchall(), [('Track 2',)])
                self.assertEqual(modern.execute('SELECT name FROM playlist').fetchall(), [('Shared',)])
            finally:
                modern.close()

    def test_mismatched_databases_do_not_produce_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            existing, ids, _ = fixture(root)
            dbapi, _, _, key = _dependencies()
            modern = _connect(dbapi, existing / 'exportLibrary.db', key)
            modern.execute("UPDATE content SET path='/Contents/different.wav' WHERE content_id=2")
            modern.commit()
            modern.close()
            with self.assertRaisesRegex(ValueError, 'catalogs differ'):
                edit(existing, root / 'result', 'track', ids[0])
            self.assertFalse((root / 'result').exists())


if __name__ == '__main__':
    unittest.main()
