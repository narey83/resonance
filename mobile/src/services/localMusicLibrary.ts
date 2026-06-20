import {
  requestPermissionsAsync,
  Asset,
  Album,
  Query,
  AssetField,
  MediaType,
} from 'expo-media-library';
import { readId3Tags } from './id3Reader';
import { MusicTrack, MusicAlbum, MusicArtist, MusicFolder, TracksResult } from '../api/musicLibrary';
import {
  getMetadataForPaths,
  upsertMetadata,
  pruneRemovedTracks,
  clearLocalMetadata,
  cacheArtwork,
  type TrackMetadata,
} from './metadataDb';

export const isLocalPath = (path: string) =>
  path.startsWith('file://') || path.startsWith('content://');

export const isLocalFolderPath = (path: string) => path.startsWith('/');

export const requestPermissions = async (): Promise<boolean> => {
  const { status } = await requestPermissionsAsync(false, ['audio']);
  return status === 'granted';
};

const extractDirectory = (uri: string): string => {
  if (!uri.startsWith('file://')) return '';
  const path = decodeURIComponent(uri.slice(7));
  const lastSlash = path.lastIndexOf('/');
  return lastSlash > 0 ? path.slice(0, lastSlash) : '';
};

const metadataToMusicTrack = (uri: string, filename: string, meta: TrackMetadata): MusicTrack => ({
  path: uri,
  filename,
  directory: extractDirectory(uri),
  duration: meta.duration,
  title: meta.title ?? filename.replace(/\.[^.]+$/, ''),
  artist: meta.artist,
  albumArtist: meta.albumArtist,
  album: meta.album,
  year: meta.year,
  trackNumber: meta.trackNumber,
  discNumber: meta.discNumber,
  hasArtwork: meta.hasArtwork,
  coverPath: meta.artworkPath ?? null,
  genre: meta.genre,
  bpm: meta.bpm,
  key: meta.musicalKey,
  fileSize: meta.fileSize,
});

interface AssetBasics {
  asset: Asset;
  uri: string;         // file:// path — used as DB cache key and for directory extraction
  contentUri: string;  // content://media/... URI — used for actual file reading (Android 13+ scoped storage)
  filename: string;
  durationSec: number | null;
  mtime: number | null;
}

const fetchAssetBasics = async (asset: Asset): Promise<AssetBasics | null> => {
  try {
    const [uri, filename, durationMs, mtime] = await Promise.all([
      asset.getUri(),
      asset.getFilename(),
      asset.getDuration(),
      asset.getModificationTime(),
    ]);
    const contentUri = asset.id;
    return {
      asset,
      uri,
      contentUri, // content URI for file reading (accessible via ContentResolver)
      filename,
      durationSec: durationMs != null ? durationMs / 1000 : null,
      mtime: mtime ?? null,
    };
  } catch {
    return null;
  }
};

const parseId3 = async (basics: AssetBasics): Promise<TrackMetadata> => {
  let title: string | null = null;
  let artist: string | null = null;
  let album: string | null = null;
  let genre: string | null = null;
  let artworkPath: string | null = null;

  try {
    const tags = await readId3Tags(basics.uri, {
      title: true, artist: true, album: true, genre: true, picture: true,
    });
    title = tags.title;
    artist = tags.artist;
    album = tags.album;
    genre = tags.genre;
    if (tags.picture) {
      const commaIdx = tags.picture.indexOf(',');
      const base64 = commaIdx >= 0 ? tags.picture.slice(commaIdx + 1) : tags.picture;
      try {
        artworkPath = await cacheArtwork(basics.uri, base64);
      } catch {
        // embedded artwork caching failed
      }
    }
  } catch {
    // ID3 parse failure — title will fall back to filename
  }

  return {
    path: basics.uri,
    source: 'local',
    title,
    artist,
    albumArtist: null,
    album,
    year: null,
    genre,
    trackNumber: null,
    discNumber: null,
    duration: basics.durationSec,
    bpm: null,
    musicalKey: null,
    fileSize: null,
    hasArtwork: artworkPath !== null,
    artworkPath,
    fileMtime: basics.mtime,
    cachedAt: Date.now(),
  };
};

// Session-level cache — resets on app restart, avoids redundant scans within a session.
let _trackCache: MusicTrack[] | null = null;
let _trackCacheTime = 0;
let _backgroundScan: Promise<void> | null = null;
// Set by the app to bump libraryRevision whenever a scan batch completes.
let _onScanProgress: (() => void) | null = null;

export const setScanProgressCallback = (cb: () => void) => { _onScanProgress = cb; };

export const invalidateLocalTracksCache = () => {
  _trackCache = null;
};

export const forceRescanLocalTracks = async (): Promise<void> => {
  _trackCache = null;
  _backgroundScan = null;
  await clearLocalMetadata();
};

export const getAllLocalTracks = async (): Promise<MusicTrack[]> => {
  const now = Date.now();
  if (_trackCache && now - _trackCacheTime < 5 * 60_000) return _trackCache;

  if (!await requestPermissions()) return [];

  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .exe();

  const basics = (await Promise.all(assets.map(fetchAssetBasics)))
    .filter((b): b is AssetBasics => b !== null);

  const uris = basics.map(b => b.uri);
  const cached = await getMetadataForPaths(uris);

  const stale = basics.filter(b => {
    const c = cached.get(b.uri);
    return !c || c.fileMtime !== b.mtime;
  });

  const buildTrackList = (): MusicTrack[] =>
    basics.map(b => {
      const meta = cached.get(b.uri) ?? {
        path: b.uri, source: 'local' as const,
        title: null, artist: null, albumArtist: null, album: null,
        year: null, genre: null, trackNumber: null, discNumber: null,
        duration: b.durationSec, bpm: null, musicalKey: null, fileSize: null,
        hasArtwork: false, artworkPath: null, fileMtime: b.mtime, cachedAt: Date.now(),
      };
      return metadataToMusicTrack(b.uri, b.filename, {
        ...meta, duration: meta.duration ?? b.durationSec,
      });
    });

  // Return whatever we have immediately so the UI is not blocked.
  _trackCache = buildTrackList();
  _trackCacheTime = now;

  if (stale.length > 0 && !_backgroundScan) {
    _backgroundScan = (async () => {
      const BATCH = 32;
      for (let i = 0; i < stale.length; i += BATCH) {
        const parsed = await Promise.all(stale.slice(i, i + BATCH).map(parseId3));
        await upsertMetadata(parsed);
        for (const e of parsed) cached.set(e.path, e);
        _trackCache = buildTrackList();
        _trackCacheTime = Date.now();
        _onScanProgress?.();
      }
      pruneRemovedTracks(uris, 'local').catch(() => {});
      _backgroundScan = null;
    })();
  }

  return _trackCache;
};

export const getLocalTracks = async (offset = 0, limit = 50): Promise<TracksResult> => {
  const all = await getAllLocalTracks();
  return { total: all.length, offset, limit, tracks: all.slice(offset, offset + limit) };
};

export const getLocalAlbums = async (): Promise<MusicAlbum[]> => {
  if (!await requestPermissions()) return [];

  const albums = await Album.getAll();
  const albumData = await Promise.all(
    albums.map(async (album) => {
      const [title, audioAssets] = await Promise.all([
        album.getTitle(),
        new Query().eq(AssetField.MEDIA_TYPE, MediaType.AUDIO).album(album).exe(),
      ]);
      return { title, assetCount: audioAssets.length };
    })
  );

  return albumData
    .filter(a => a.assetCount > 0)
    .map(({ title, assetCount }) => ({
      album: title,
      artist: '',
      albumArtist: null,
      year: null,
      trackCount: assetCount,
      totalDuration: null,
      coverPath: null,
      hasArtwork: false,
    }));
};

export const getLocalAlbumTracks = async (albumTitle: string): Promise<MusicTrack[]> => {
  if (!await requestPermissions()) return [];

  const album = await Album.get(albumTitle);
  if (!album) return [];

  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .album(album)
    .exe();

  const basics = (await Promise.all(assets.map(fetchAssetBasics)))
    .filter((b): b is AssetBasics => b !== null);

  const uris = basics.map(b => b.uri);
  const cached = await getMetadataForPaths(uris);

  return basics.map(b => {
    const meta = cached.get(b.uri);
    if (!meta) {
      return {
        path: b.uri, filename: b.filename, directory: extractDirectory(b.uri),
        duration: b.durationSec, title: b.filename.replace(/\.[^.]+$/, ''),
        artist: null, albumArtist: null, album: albumTitle,
        year: null, trackNumber: null, discNumber: null,
        hasArtwork: false, coverPath: null, genre: null, bpm: null, key: null, fileSize: null,
      };
    }
    return metadataToMusicTrack(b.uri, b.filename, { ...meta, duration: meta.duration ?? b.durationSec });
  });
};

export const getLocalFolders = async (): Promise<MusicFolder[]> => {
  const tracks = await getAllLocalTracks();
  const folderMap = new Map<string, MusicFolder>();
  for (const track of tracks) {
    const dir = track.directory;
    if (!dir) continue;
    const name = dir.split('/').filter(Boolean).pop() ?? dir;
    const existing = folderMap.get(dir);
    if (existing) {
      existing.trackCount++;
      if (!existing.coverPath && track.coverPath) {
        existing.coverPath = track.coverPath;
        existing.hasArtwork = true;
      }
    } else {
      folderMap.set(dir, {
        name, path: dir, trackCount: 1,
        coverPath: track.coverPath ?? null,
        hasArtwork: track.hasArtwork,
      });
    }
  }
  return Array.from(folderMap.values());
};

export const getLocalFolderTracks = async (dirPath: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.directory === dirPath);
};

export const getLocalArtists = async (): Promise<MusicArtist[]> => {
  return [];
};
