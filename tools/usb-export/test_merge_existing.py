import tempfile
import unittest
import wave
import json
from pathlib import Path

from rekordbox_pdb import Database
from rekordbox_pdb.edit import PdbEditor

from merge_existing import merge
from preflight_existing import inspect
from onelibrary_writer import _connect, _dependencies, write_onelibrary
from usb_export import prepare, sha


class MergeExistingTests(unittest.TestCase):
    def test_preserves_old_tracks_and_playlists_in_both_databases(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            existing = root / 'existing'
            old_db = existing / 'PIONEER/rekordbox'
            old_db.mkdir(parents=True)
            editor = PdbEditor((Path(__file__).parent / 'legacy-empty-template.pdb').read_bytes())
            old_id = editor.add_track('Old track', '/Contents/Old/old.wav', analyze_path='/PIONEER/USBANLZ/P001/old/ANLZ0000.DAT')
            old_playlist = editor.create_playlist('Old playlist')
            editor.add_to_playlist(old_playlist, old_id)
            editor.save(old_db / 'export.pdb')
            old = dict(id=1, title='Old track', artist='Old artist', album='', genre='', key='', bpm=120,
                       durationSeconds=1, sampleRate=44100, bitRate=1411, bitDepth=16, fileBytes=176400,
                       usbPath='/Contents/Old/old.wav', anlzPath='/PIONEER/USBANLZ/P001/old/ANLZ0000.DAT', cues=[])
            write_onelibrary(existing, [old], 'Old playlist')
            source = root / 'new.wav'
            with wave.open(str(source), 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b'\0' * 44100 * 4)
            analysis = {'scope': {'fullTrack': True}, 'durationSeconds': 1.0,
                        'featureAvailability': {'beats': 'available', 'key': 'available', 'waveform': 'available'},
                        'features': {'beats': {'result': {'bpm_median_interval': 120, 'beats_seconds': [0, .5], 'downbeats_seconds': [0]}},
                                     'key': {'result': {'key': 'Am'}}, 'genre': {'result': {'scores': []}},
                                     'waveform': {'result': {'overallPeaks': [.1, .5], 'bands': {'low': [.1, .4], 'mid': [.7, .1], 'high': [.4, .8]}}}}}
            job = 'a' * 32
            manifest = {'schemaVersion': 1, 'jobId': job, 'playlistName': 'New playlist',
                        'tracks': [{'id': 1, 'sourceKey': 'b' * 64, 'sourcePath': str(source),
                                    'sourceSha256': sha(source), 'sourceBytes': source.stat().st_size,
                                    'title': 'New track', 'artist': 'New artist', 'analysis': analysis}]}
            prepared = root / 'prepared'
            result = prepare(manifest, prepared, 'dual', 'unused', 'ffprobe')
            self.assertEqual(result['jobId'], job)
            self.assertTrue((prepared / f'Contents/Resonance/{job}/00001-track.wav').is_file())
            checked = inspect(old_db, prepared / 'export-manifest.json', [])
            self.assertEqual(checked['audioPaths'], ['/Contents/Old/old.wav'])
            duplicate_name = root / 'duplicate-name.json'
            duplicate_name.write_text(json.dumps({**result, 'playlistName': ' OLD PLAYLIST '}))
            with self.assertRaisesRegex(ValueError, 'playlist with this name'):
                inspect(old_db, duplicate_name, [])
            new_audio = next(item for item in result['files'] if item['path'].startswith('Contents/'))
            record = {'schemaVersion': 1, 'files': [{'path': 'Contents/Old/old.wav', 'sha256': new_audio['sha256']}]}
            with self.assertRaisesRegex(ValueError, 'already recorded on the USB'):
                inspect(old_db, prepared / 'export-manifest.json', [record])
            merged = root / 'merged'
            self.assertEqual(merge(old_db, prepared / 'PIONEER/rekordbox', merged, 'New playlist')['addedTracks'], 1)
            classic = Database.from_file(merged / 'export.pdb')
            self.assertEqual([(t.title, t.file_path) for t in classic.tracks],
                             [('Old track', '/Contents/Old/old.wav'), ('New track', f'/Contents/Resonance/{job}/00001-track.wav')])
            self.assertEqual([p.name for p in classic.playlist_tree], ['Old playlist', 'New playlist'])
            dbapi, _, _, key = _dependencies()
            one = _connect(dbapi, merged / 'exportLibrary.db', key)
            try:
                self.assertEqual(one.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual([row[0] for row in one.execute('SELECT title FROM content ORDER BY content_id')], ['Old track', 'New track'])
                self.assertEqual([row[0] for row in one.execute('SELECT name FROM playlist ORDER BY playlist_id')], ['Old playlist', 'New playlist'])
                self.assertEqual(one.execute('SELECT count(*) FROM playlist_content').fetchone()[0], 2)
            finally:
                one.close()
            with self.assertRaisesRegex(ValueError, 'already exists|collides'):
                merge(prepared / 'PIONEER/rekordbox', prepared / 'PIONEER/rekordbox', root / 'collision', 'Duplicate')
            self.assertFalse((root / 'collision').exists())
            with self.assertRaisesRegex(ValueError, 'playlist with this name already exists'):
                merge(old_db, prepared / 'PIONEER/rekordbox', root / 'same-name', 'OLD PLAYLIST')
            self.assertFalse((root / 'same-name').exists())


if __name__ == '__main__':
    unittest.main()
