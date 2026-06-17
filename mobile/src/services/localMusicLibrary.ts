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
    // Use contentUri (content://media/...) for reading — the file:// path in basics.uri
    // is inaccessible on Android 13+ scoped storage even with READ_MEDIA_AUDIO.
    const tags = await readId3Tags(basics.contentUri, {
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

export const invalidateLocalTracksCache = () => {
  _trackCache = null;
};

export const getAllLocalTracks = async (): Promise<MusicTrack[]> => {
  const now = Date.now();
  if (_trackCache && now - _trackCacheTime < 5 * 60_000) return _trackCache;

  if (!await requestPermissions()) return [];

  // 1. Fetch all audio assets from MediaStore
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .limit(2000)
    .exe();

  // 2. Fetch uri/filename/duration/mtime in parallel
  const basics = (await Promise.all(assets.map(fetchAssetBasics)))
    .filter((b): b is AssetBasics => b !== null);

  const uris = basics.map(b => b.uri);

  // 3. Load existing cached metadata from DB
  const cached = await getMetadataForPaths(uris);

  // 4. Identify stale tracks (not in cache or mtime changed)
  const stale = basics.filter(b => {
    const c = cached.get(b.uri);
    if (!c) return true;
    if (c.fileMtime !== b.mtime) return true;
    return false;
  });

  // 5. Parse ID3 for stale tracks (batches of 8 to limit concurrent I/O)
  if (stale.length > 0) {
    const newEntries: TrackMetadata[] = [];
    for (let i = 0; i < stale.length; i += 8) {
      const batch = stale.slice(i, i + 8);
      const parsed = await Promise.all(batch.map(parseId3));
      newEntries.push(...parsed);
    }
    await upsertMetadata(newEntries);
    for (const e of newEntries) {
      cached.set(e.path, e);
    }
  }

  // 6. Remove DB entries for files that no longer exist
  pruneRemovedTracks(uris, 'local').catch(() => {});

  // 7. Build final track list
  const tracks: MusicTrack[] = basics.map(b => {
    const meta = cached.get(b.uri)!;
    return metadataToMusicTrack(b.uri, b.filename, {
      ...meta,
      duration: meta.duration ?? b.durationSec,
    });
  });

  _trackCache = tracks;
  _trackCacheTime = now;
  return tracks;
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
      if (!existing.coverPath && track.coverPath) existing.coverPath = track.coverPath;
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
