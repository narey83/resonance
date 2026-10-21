"""Experimental encrypted OneLibrary staging writer; no hardware verification.

Schema and key handling are supplied by MIT-licensed pyrekordbox (pinned in
onelibrary-provenance.json). This module never edits an existing database.
"""
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import os


def _usb_path(value):
    path = PurePosixPath(str(value))
    if not str(path).startswith('/') or '..' in path.parts or '\\' in str(value):
        raise ValueError('USB paths must be absolute POSIX paths without traversal')
    return str(path)


def _dependencies():
    from sqlcipher3 import dbapi2
    from sqlalchemy import create_engine
    from pyrekordbox.onelibrary import models
    from pyrekordbox.onelibrary.database import BLOB
    from pyrekordbox.utils import deobfuscate
    return dbapi2, create_engine, models, deobfuscate(BLOB)


def _connect(dbapi, path, key):
    connection = dbapi.connect(str(path))
    # The library-supplied key stays in memory and is never logged.
    connection.execute("PRAGMA key='" + key.replace("'", "''") + "'")
    connection.execute('PRAGMA journal_mode=DELETE')
    return connection


def write_onelibrary(destination: Path, tracks: list, playlist_name: str) -> Path:
    """Write a NEW exportLibrary.db below a staged USB root.

    Requires pyrekordbox + SQLAlchemy + sqlcipher3. Existing output is refused.
    Database cues currently contain memory cues/loops only; hot cues belong to
    ANLZ until their OneLibrary kind mapping has independent validation.
    """
    dbapi, create_engine, models, key = _dependencies()
    destination = Path(destination)
    target = destination / 'PIONEER/rekordbox/exportLibrary.db'
    if target.exists():
        raise FileExistsError(target)
    ids = [int(t['id']) for t in tracks]
    if any(i <= 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Track IDs must be distinct positive integers')
    for track in tracks:
        _usb_path(track['usbPath'])
        _usb_path(track['anlzPath'])
        if PurePosixPath(track['usbPath']).suffix.lower() not in {'.mp3', '.wav', '.aiff', '.aif', '.m4a', '.flac'}:
            raise ValueError('Unsupported audio file extension')
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name('exportLibrary.db.creating')
    # Exclusive creation prevents another export sharing this temporary name.
    with temp.open('xb'):
        pass
    engine = create_engine('sqlite://', creator=lambda: _connect(dbapi, temp, key))
    metadata = models.Base.metadata
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    def insert(connection, table_name, values):
        table = metadata.tables[table_name]
        row = {}
        for column in table.columns:
            if column.name in values:
                row[column.name] = values[column.name]
            elif not column.nullable and not column.primary_key:
                kind = column.type.__class__.__name__.lower()
                row[column.name] = now if 'datetime' in kind else ('' if 'char' in kind or 'text' in kind else 0)
        connection.execute(table.insert().values(**row))
    try:
        metadata.create_all(engine)
        with engine.begin() as connection:
            # Provisional menu IDs observed in public format research; not player-certified.
            menus = [(1,1,'GENRE'),(2,2,'ARTIST'),(3,3,'ALBUM'),(4,4,'TRACK'),(5,6,'PLAYLIST'),(6,7,'HISTORY'),(7,10,'KEY'),(8,12,'BPM'),(9,13,'RATING'),(10,14,'COLOR'),(11,16,'TIME'),(12,17,'BITRATE'),(13,19,'FILENAME'),(14,23,'LABEL'),(15,28,'REMIXER'),(16,29,'DJ PLAY COUNT'),(17,30,'YEAR'),(18,31,'HOT CUE BANK LIST'),(19,33,'MY TAG'),(20,34,'COMMENT'),(21,35,'DATE ADDED')]
            for sequence,(identifier,kind,name) in enumerate(menus,1):
                insert(connection,'menuItem',{'menuItem_id':identifier,'kind':kind,'name':'\ufffa'+name+'\ufffb'})
                insert(connection,'category',{'category_id':sequence,'menuItem_id':identifier,'sequenceNo':sequence,'isVisible':int(name in {'TRACK','ARTIST','ALBUM','GENRE','PLAYLIST','KEY','BPM'})})
            for sequence,identifier in enumerate([4,2,3,8,9,1,7,14,17,21],1):
                insert(connection,'sort',{'sort_id':sequence,'menuItem_id':identifier,'sequenceNo':sequence,'isVisible':1,'isSelectedAsSubColumn':int(sequence==1)})
            for identifier,name in enumerate(['Pink','Red','Orange','Yellow','Green','Aqua','Blue','Purple'],1):
                insert(connection,'color',{'color_id':identifier,'name':name})
            lookup = {}
            for name, field in [('artist', 'artist'), ('album', 'album'), ('genre', 'genre'), ('key', 'key')]:
                lookup[name] = {}
                if name == 'key':
                    for identifier,text in enumerate(['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B','Cm','Dbm','Dm','Ebm','Em','Fm','F#m','Gm','Abm','Am','Bbm','Bm'],1):
                        lookup[name][text]=identifier
                        insert(connection,'key',{'key_id':identifier,'name':text})
                for track in tracks:
                    text = str(track.get(field) or '')
                    if text and text not in lookup[name]:
                        identifier = len(lookup[name]) + 1
                        lookup[name][text] = identifier
                        insert(connection, name, {name + '_id': identifier, 'name': text, 'nameForSearch': text.casefold()})
            insert(connection, 'playlist', {'playlist_id': 1, 'name': playlist_name, 'sequenceNo': 1, 'attribute': 0, 'playlist_id_parent': 0})
            cue_id = 0
            file_types = {'.mp3': int(models.FileType.MP3), '.m4a': int(models.FileType.M4A), '.wav': int(models.FileType.WAV), '.aif': int(models.FileType.AIFF), '.aiff': int(models.FileType.AIFF), '.flac': int(models.FileType.FLAC)}
            for sequence, track in enumerate(tracks, 1):
                path = _usb_path(track['usbPath'])
                values = dict(content_id=int(track['id']), title=str(track['title']), titleForSearch=str(track['title']).casefold(),
                    bpmx100=round(float(track.get('bpm') or 0)*100), length=round(float(track['durationSeconds'])*1000),
                    path=path, fileName=PurePosixPath(path).name, fileSize=int(track['fileBytes']),
                    fileType=file_types[PurePosixPath(path).suffix.lower()], bitrate=int(track.get('bitRate') or 0),
                    bitDepth=int(track.get('bitDepth') or 0), samplingRate=int(track.get('sampleRate') or 0),
                    analysisDataFilePath=_usb_path(track['anlzPath']), dateCreated=now, dateAdded=now,
                    hasModified=0, cueUpdateCount=0, analysisDataUpdateCount=0, informationUpdateCount=0)
                for name, column in [('artist', 'artist_id_artist'), ('album', 'album_id'), ('genre', 'genre_id'), ('key', 'key_id')]:
                    values[column] = lookup[name].get(str(track.get(name) or ''), 0)
                insert(connection, 'content', values)
                insert(connection, 'playlist_content', {'playlist_id': 1, 'content_id': int(track['id']), 'sequenceNo': sequence})
                for cue in track.get('cues', []):
                    if cue.get('hotCueNumber', 0):
                        continue
                    cue_id += 1
                    start = int(cue['timeMs'])
                    end = int(cue.get('loopEndMs') or start)
                    if start < 0 or end < start or end > values['length']:
                        raise ValueError('Cue lies outside track duration')
                    insert(connection, 'cue', dict(cue_id=cue_id, content_id=int(track['id']), kind=4 if end > start else 0,
                        inUsec=start*1000, outUsec=end*1000, in150FramePerSec=round(start*.15), out150FramePerSec=round(end*.15),
                        cueComment=str(cue.get('name') or ''), isActiveLoop=0))
            insert(connection, 'property', dict(deviceName='Resonance', dbVersion=1000, numberOfContents=len(tracks), createdDate=now, myTagMasterDBID=0, backGroundColorType=0))
        engine.dispose()
        validate_onelibrary(temp, tracks)
        # Link publishes without overwriting a concurrent finished export.
        os.link(temp, target)
        temp.unlink()
        return target
    finally:
        engine.dispose()
        if temp.exists():
            temp.unlink()


def validate_onelibrary(path: Path, tracks: list) -> dict:
    """Read back with SQLCipher DBAPI, independently of SQLAlchemy writes."""
    dbapi, _, _, key = _dependencies()
    if Path(path).read_bytes()[:16] == b'SQLite format 3\x00':
        raise ValueError('OneLibrary database must be encrypted')
    connection = _connect(dbapi, path, key)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLCipher integrity check failed')
        rows = connection.execute('SELECT content_id,title,path,analysisDataFilePath,bpmx100,length,fileSize FROM content ORDER BY content_id').fetchall()
        expected = sorted((int(t['id']), str(t['title']), _usb_path(t['usbPath']), _usb_path(t['anlzPath']), round(float(t.get('bpm') or 0)*100), round(float(t['durationSeconds'])*1000), int(t['fileBytes'])) for t in tracks)
        if rows != expected:
            raise ValueError('OneLibrary content read-back mismatch')
        playlist = [row[0] for row in connection.execute('SELECT content_id FROM playlist_content ORDER BY sequenceNo')]
        if playlist != [int(t['id']) for t in tracks]:
            raise ValueError('OneLibrary playlist read-back mismatch')
        return {'tracks': len(rows), 'encrypted': True, 'integrity': 'ok', 'hardwareVerified': False}
    finally:
        connection.close()
