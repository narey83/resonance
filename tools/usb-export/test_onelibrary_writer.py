import tempfile
import unittest
from pathlib import Path
from onelibrary_writer import write_onelibrary, validate_onelibrary, _dependencies, _connect
class OneLibraryTests(unittest.TestCase):
    def tracks(self):
        return [dict(id=7,title='Café example',artist='Artist',album='Album',genre='House',key='Am',bpm=123.45,durationSeconds=20.123,sampleRate=44100,bitRate=320,fileBytes=12345,usbPath='/Contents/example.mp3',anlzPath='/PIONEER/USBANLZ/P001/TEST/ANLZ0000.DAT',cues=[dict(timeMs=1000,hotCueNumber=0),dict(timeMs=2000,loopEndMs=4000,hotCueNumber=0)])]
    def test_encrypted_roundtrip_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            target=write_onelibrary(Path(folder),self.tracks(),'Test set')
            self.assertEqual(validate_onelibrary(target,self.tracks())['tracks'],1)
            self.assertNotEqual(target.read_bytes()[:16],b'SQLite format 3\0')
            before=target.read_bytes()
            with self.assertRaises(FileExistsError): write_onelibrary(Path(folder),self.tracks(),'Other')
            self.assertEqual(before,target.read_bytes())
    def test_browse_bootstrap_and_file_types(self):
        with tempfile.TemporaryDirectory() as folder:
            tracks=self.tracks();tracks[0]['usbPath']='/Contents/example.flac'
            target=write_onelibrary(Path(folder),tracks,'Test')
            dbapi,_,_,key=_dependencies();connection=_connect(dbapi,target,key)
            try:
                self.assertEqual(connection.execute('SELECT count(*) FROM key').fetchone()[0],24)
                self.assertEqual(connection.execute('SELECT count(*) FROM color').fetchone()[0],8)
                self.assertEqual(connection.execute('SELECT count(*) FROM category WHERE isVisible=1').fetchone()[0],7)
                self.assertEqual(connection.execute('SELECT fileType FROM content').fetchone()[0],5)
                self.assertEqual(connection.execute('SELECT name FROM menuItem WHERE menuItem_id=5').fetchone()[0],'\ufffaPLAYLIST\ufffb')
            finally:connection.close()
    def test_duplicate_ids_and_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): write_onelibrary(Path(folder),self.tracks()*2,'Invalid')
            tracks=self.tracks();tracks[0]['usbPath']='/Contents/../secret.mp3'
            with self.assertRaises(ValueError): write_onelibrary(Path(folder),tracks,'Invalid')
    def test_bad_cue_leaves_no_database(self):
        with tempfile.TemporaryDirectory() as folder:
            tracks=self.tracks();tracks[0]['cues']=[dict(timeMs=30000)]
            with self.assertRaises(ValueError): write_onelibrary(Path(folder),tracks,'Invalid')
            self.assertFalse(list(Path(folder).rglob('*.db*')))
if __name__=='__main__': unittest.main()
