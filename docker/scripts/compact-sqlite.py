#!/usr/bin/env python3
"""Offline SQLite reclamation with a retained original inode and validated atomic replacement."""
import argparse
from contextlib import closing
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import stat
import subprocess
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sync_directory(path):
    fd = os.open(path, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def compact(database, backup_dir, notify=print, timeout=1200):
    """Caller must stop every writer first. Never modify the source via in-place VACUUM."""
    database, backup_dir = Path(database), Path(backup_dir)
    backup_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    os.chmod(backup_dir, 0o700)
    require(database.stat().st_dev == backup_dir.stat().st_dev, 'Backup must be on the same filesystem')
    backup = backup_dir / database.name
    candidate = database.with_name('.' + database.name + '.compacting')
    require(not candidate.exists(), 'An earlier candidate needs review')
    installed = False
    report = {'database': str(database), 'backup': str(backup), 'backupKind': 'retained-original-inode'}
    started, last = time.monotonic(), 0
    phase = 'checkpoint'

    def progress():
        nonlocal last
        now = time.monotonic()
        if now - started > timeout:
            return 1
        if now - last > 15:
            last = now
            notify(f'{phase}: {int(now-started)}s, candidate {candidate.stat().st_size if candidate.exists() else 0} bytes')
        return 0

    def connection(path, readonly=False):
        c = sqlite3.connect('file:' + str(path) + ('?mode=ro' if readonly else ''), uri=True, timeout=10)
        c.set_progress_handler(progress, 1_000_000)
        return closing(c)

    def inventory(c):
        names = [r[0] for r in c.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {n: c.execute('SELECT COUNT(*) FROM "' + n.replace('"', '""') + '"').fetchone()[0] for n in names}

    def schema(c):
        return c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()

    try:
        with connection(database) as c:
            result = c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
            require(result[0] == 0, 'A reader prevented the final checkpoint')
            exists = c.execute("SELECT 1 FROM sqlite_schema WHERE name='legacy_public_LogEntries'").fetchone()
            require(not exists or c.execute('SELECT 1 FROM legacy_public_LogEntries LIMIT 1').fetchone() is None, 'Legacy compaction is unfinished')
            journal = c.execute('PRAGMA journal_mode').fetchone()[0]
        original = database.stat()
        require(shutil.disk_usage(database.parent).free > original.st_size, 'Insufficient candidate headroom')
        # During maintenance this link retains the untouched source. Atomic replacement leaves
        # it as the sole name of the original inode, independent of all future live DB writes.
        os.link(database, backup)
        sync_directory(backup_dir)
        phase = 'inventory'
        with connection(database, True) as c:
            before = inventory(c)
            original_schema = schema(c)
            foreign_keys = c.execute('PRAGMA foreign_key_check').fetchall()
            phase = 'vacuum'
            notify('Creating a compacted candidate; original retained without a redundant full-file copy')
            c.execute('VACUUM INTO ?', (str(candidate),))
        phase = 'validation'
        with connection(candidate) as c:
            require(c.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Candidate integrity check failed')
            require(inventory(c) == before, 'Table counts changed')
            require(schema(c) == original_schema, 'Schema changed')
            require(c.execute('PRAGMA foreign_key_check').fetchall() == foreign_keys, 'Foreign key results changed')
        # Reopen after validation so no cached schema/read statement can hold a
        # lock while switching the candidate's persistent journal mode.
        if journal == 'wal':
            with connection(candidate) as c:
                c.execute('PRAGMA journal_mode=WAL').fetchall()
        current = database.stat()
        require((current.st_dev, current.st_ino, current.st_mtime_ns, current.st_size) == (original.st_dev, original.st_ino, original.st_mtime_ns, original.st_size), 'Source changed during maintenance')
        os.chmod(candidate, stat.S_IMODE(original.st_mode))
        require(candidate.stat().st_uid == original.st_uid, 'Candidate owner differs')
        with candidate.open('rb') as f:
            os.fsync(f.fileno())
        report.update(originalBytes=original.st_size, compactedBytes=candidate.stat().st_size,
                      counts=before, tablesVerified=len(before), integrity='ok', journalMode=journal)
        report['reclaimedBytes'] = report['originalBytes'] - report['compactedBytes']
        notify('validated')
        for suffix in ['-wal', '-shm']:
            p = Path(str(database) + suffix)
            if p.exists():
                require(suffix != '-wal' or p.stat().st_size == 0, 'A new WAL appeared')
                p.unlink()
        os.replace(candidate, database)
        installed = True
        sync_directory(database.parent)
        sync_directory(backup_dir)
        require(backup.stat().st_ino != database.stat().st_ino, 'Rollback still shares the active inode')
        report['installed'] = True
        return report
    finally:
        if candidate.exists():
            candidate.unlink()
        if not installed and backup.exists() and database.exists() and os.path.samefile(backup, database):
            # A failed attempt must not leave a supposedly immutable backup linked to live data.
            backup.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--backup-root', required=True, type=Path)
    parser.add_argument('--container', required=True)
    parser.add_argument('--maintenance-marker', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        with closing(sqlite3.connect('file:' + str(args.database) + '?mode=ro', uri=True)) as c:
            print(json.dumps({k: c.execute('PRAGMA ' + k).fetchone()[0] for k in ['page_count', 'freelist_count', 'page_size']}))
        return
    def interrupted(signum, frame):
        raise InterruptedError('Maintenance interrupted; original data retained')
    for sig in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
        signal.signal(sig, interrupted)
    require(not args.maintenance_marker.exists(), 'Another maintenance operation is active')
    require(args.database.stat().st_uid == os.getuid(), 'Run as the database owner')
    require(args.database.stat().st_dev == args.backup_root.stat().st_dev, 'Rollback must share the database filesystem')
    marker_tmp = args.maintenance_marker.with_suffix('.tmp')
    marker_tmp.write_text(json.dumps({'startedAt': time.time(), 'observedOffline': False}))
    os.replace(marker_tmp, args.maintenance_marker)
    stopped = False
    try:
        subprocess.run(['docker', 'stop', '--time', '120', args.container], check=True, stdout=subprocess.DEVNULL)
        stopped = True
        holders = subprocess.run(['fuser', str(args.database)], capture_output=True, text=True)
        require(not holders.stdout.strip(), 'Database still has open handles')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
        backup = args.backup_root / ('sqlite-reclaim-' + stamp)
        report = compact(args.database, backup, notify=lambda s: print(s, flush=True))
        report['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (backup / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)
    finally:
        if stopped:
            subprocess.run(['docker', 'start', args.container], check=True, stdout=subprocess.DEVNULL)
            print('Backend restarted; maintenance coordinator will verify recovery', flush=True)

if __name__ == '__main__':
    main()
