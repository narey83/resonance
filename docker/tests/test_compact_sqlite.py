import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
spec=importlib.util.spec_from_file_location('compact',Path(__file__).parents[1]/'scripts/compact-sqlite.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class CompactionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.db=self.root/'live.db'
        with closing(sqlite3.connect(self.db)) as c:
            c.executescript('PRAGMA journal_mode=WAL; CREATE TABLE parent(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id)); CREATE INDEX child_parent ON child(parent_id); CREATE TABLE legacy_public_LogEntries(Id INTEGER);')
            c.executemany('INSERT INTO parent VALUES (?,?)',[(i,'x'*4000) for i in range(1,151)])
            c.execute('INSERT INTO child VALUES (1,1)');c.execute('DELETE FROM parent WHERE id>2');c.commit()
        self.sha=hashlib.sha256(self.db.read_bytes()).hexdigest()
    def tearDown(self):self.temp.cleanup()
    def test_original_inode_is_retained_and_independent_after_new_writes(self):
        result=module.compact(self.db,self.root/'backup',notify=lambda _:None)
        original=Path(result['backup'])
        self.assertGreater(result['reclaimedBytes'],0)
        self.assertEqual(result['tablesVerified'],3)
        self.assertNotEqual(self.db.stat().st_ino,original.stat().st_ino)
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(),self.sha)
        with closing(sqlite3.connect(self.db)) as c:c.execute("UPDATE parent SET value='new' WHERE id=1");c.commit()
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(),self.sha)
        with closing(sqlite3.connect(original)) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM parent').fetchone()[0],2)
    def test_validation_failure_leaves_live_database_unchanged_and_removes_shared_backup(self):
        def fail(stage):
            if stage=='validated':raise RuntimeError('simulated interruption')
        with self.assertRaises(RuntimeError):module.compact(self.db,self.root/'backup',notify=fail)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.sha)
        self.assertFalse((self.root/'backup/live.db').exists())
        self.assertFalse(self.db.with_name('.live.db.compacting').exists())
    def test_unfinished_legacy_compaction_is_rejected(self):
        with closing(sqlite3.connect(self.db)) as c:c.execute('INSERT INTO legacy_public_LogEntries VALUES (1)');c.commit()
        with self.assertRaises(RuntimeError):module.compact(self.db,self.root/'backup',notify=lambda _:None)
        self.assertFalse((self.root/'backup/live.db').exists())

if __name__=='__main__':unittest.main()
