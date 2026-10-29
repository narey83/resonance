from pathlib import Path
import hashlib
import json
import tempfile
import unittest
from export_inspection import inspect_export, write_inspection
from onelibrary_writer import write_onelibrary

class ExportInspectionTests(unittest.TestCase):
    def fixture(self, parent, dual=False):
        from rekordbox_pdb.edit import PdbEditor
        root = Path(parent) / 'export'
        directory = root / 'PIONEER/rekordbox'
        directory.mkdir(parents=True)
        editor = PdbEditor((Path(__file__).parent / 'legacy-empty-template.pdb').read_bytes())
        editor.add_track(title='Database title', file_path='/Contents/track.wav', artist='Artist', album='Album', key='Am', tempo=12300, duration=3, sample_rate=44100, bitrate=1411, sample_depth=16, file_size=1234, analyze_path='/PIONEER/analysis.DAT')
        playlist = editor.create_playlist('Database playlist')
        editor.add_to_playlist(playlist, 1)
        editor.save(directory / 'export.pdb')
        if dual:
            write_onelibrary(root, [dict(id=1,title='Database title',usbPath='/Contents/track.wav',anlzPath='/PIONEER/analysis.DAT',bpm=123,durationSeconds=3,fileBytes=1234)], 'Database playlist')
        files = [dict(path=p.relative_to(root).as_posix(), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in directory.iterdir()]
        (root / 'export-manifest.json').write_text(json.dumps(dict(profile='dual' if dual else 'legacy', playlistName='Manifest title', files=files, audioPolicy='Prepared on server')))
        return root

    def test_reads_database_values_and_preserves_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp, dual=True)
            before = {p:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
            report = write_inspection(root, Path(temp)/'inspection.json')
            self.assertEqual(report['tracks'][0]['title'], 'Database title')
            self.assertEqual(report['tracks'][0]['id'], 1)
            self.assertEqual(report['tracks'][0]['bpm'], 123)
            self.assertEqual(report['playlists'][0]['name'], 'Database playlist')
            self.assertEqual(report['playlists'][0]['trackIds'], [1])
            self.assertEqual(report['oneLibrary']['integrity'], 'ok')
            self.assertTrue(report['oneLibrary']['tracksMatchLegacy'])
            self.assertTrue(report['oneLibrary']['playlistOrderMatchesLegacy'])
            self.assertFalse(report['hardwareVerified'])
            self.assertEqual(before, {p:hashlib.sha256(p.read_bytes()).hexdigest() for p in before})
            self.assertFalse((root/'Contents').exists())

    def test_detects_database_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            path = root/'export-manifest.json'
            manifest = json.loads(path.read_text())
            manifest['files'][0]['sha256'] = '0'*64
            path.write_text(json.dumps(manifest))
            self.assertFalse(inspect_export(root)['databases'][0]['matchesManifest'])

    def test_corrupt_database_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            (root/'PIONEER/rekordbox/export.pdb').write_bytes(b'broken')
            with self.assertRaises(Exception):
                inspect_export(root)

if __name__ == '__main__':
    unittest.main()
