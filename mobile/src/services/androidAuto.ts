import TrackPlayer, { MediaItemPlayable } from 'react-native-track-player';
import {
  getArtists,
  getAlbums,
  getFolders,
  getRecentlyAdded,
  getTracks,
  getArtworkUrl,
  getStreamUrl,
  getTrackTitle,
  type MusicTrack,
  type MusicAlbum,
} from '../api/musicLibrary';
import { getPlayHistory, type PlayRecord } from '../api/libraryActivity';
import { useAuthStore } from '../store/auth';
import { remoteLog } from '../api/remoteLogger';

// Android Auto content browsing for react-native-track-player.
//
// The native side (patched RNTP) serves a flat browse-tree dict to the car and
// emits `remote-browse` when the user opens a node we haven't populated yet.
// We expand lazily: load a node's children, merge into `tree`, and re-push the
// whole dict via setBrowseTree — native then notifies the car to re-request.
//
// Playable leaf mediaIds are the track's `path`, so the `remote-play-id` handler
// can resolve them straight to a stream URL.

type BrowseItem = {
  mediaId: string;
  title: string;
  subtitle?: string;
  iconUri?: string;
  mediaUri?: string;
  playable: string;
};
type BrowseTree = Record<string, BrowseItem[]>;

const ROOT = '/';
const TAB_PLAYED = 'aa:played';
const TAB_RECENT = 'aa:recent';
const TAB_ARTISTS = 'aa:artists';
const TAB_FOLDERS = 'aa:folders';
const PREFIX_ARTIST = 'aa:artist:';
const PREFIX_ALBUM = 'aa:album:';
const PREFIX_FOLDER = 'aa:folder:';
const SEP = ''; // album mediaId = aa:album:<artist><SEP><album>

// Accumulating tree — every change re-pushes the full dict to native.
const tree: BrowseTree = {};
// Track caches so car-initiated playback can queue siblings with real metadata.
const trackByPath = new Map<string, MusicTrack>();
const tracksByNode = new Map<string, MusicTrack[]>();

// When the app UI is mounted, playback routes through PlayerContext to keep its
// queue/now-playing in sync. When RNTP runs headless (app killed, car started
// it), this stays null and we fall back to driving TrackPlayer directly.
let autoPlayHandler: ((tracks: MusicTrack[], startIndex: number) => void) | null = null;
export const registerAutoPlayHandler = (
  fn: ((tracks: MusicTrack[], startIndex: number) => void) | null,
) => {
  autoPlayHandler = fn;
};

const isAuthed = () => {
  const { accessToken, serverUrl } = useAuthStore.getState();
  return !!accessToken && !!serverUrl;
};

const browsable = (
  mediaId: string,
  title: string,
  subtitle?: string,
  iconUri?: string,
): BrowseItem => ({ mediaId, title, subtitle, iconUri, playable: MediaItemPlayable.MediaBrowsable });

const playableItem = (track: MusicTrack): BrowseItem => ({
  mediaId: track.path,
  title: getTrackTitle(track),
  subtitle: track.artist ?? undefined,
  iconUri: track.hasArtwork ? (getArtworkUrl(track.path, 256) ?? undefined) : undefined,
  mediaUri: getStreamUrl(track.path),
  playable: MediaItemPlayable.MediaPlayable,
});

// A PlayRecord lacks most MusicTrack fields; build a usable stub for queueing.
const playRecordToTrack = (r: PlayRecord): MusicTrack => ({
  path: r.path,
  filename: r.path.split(/[/\\]/).pop() ?? r.path,
  directory: r.folder ?? '',
  duration: null,
  title: r.title || null,
  artist: r.artist || null,
  albumArtist: null,
  album: null,
  year: null,
  trackNumber: null,
  discNumber: null,
  hasArtwork: true, // best-effort; artwork endpoint resolves by path
  genre: null,
  bpm: null,
  key: null,
  fileSize: null,
});

const albumNodeId = (a: MusicAlbum) =>
  PREFIX_ALBUM + encodeURIComponent(a.albumArtist ?? a.artist) + SEP + encodeURIComponent(a.album);

const recordTracks = (nodeId: string, tracks: MusicTrack[]) => {
  tracksByNode.set(nodeId, tracks);
  for (const t of tracks) trackByPath.set(t.path, t);
};

const push = async () => {
  try {
    await TrackPlayer.setBrowseTree(tree as Record<string, Array<Record<string, unknown>>>);
  } catch (e) {
    remoteLog('error', `[aa] setBrowseTree failed — ${String(e)}`);
  }
};

const loadNode = async (mediaId: string): Promise<void> => {
  if (mediaId === TAB_PLAYED) {
    const history = await getPlayHistory(50);
    const stubs = history.map(playRecordToTrack);
    tree[mediaId] = stubs.map(playableItem);
    recordTracks(mediaId, stubs);
  } else if (mediaId === TAB_RECENT) {
    const albums = await getRecentlyAdded(30);
    tree[mediaId] = albums.map((a) =>
      browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, 256) ?? undefined) : undefined),
    );
  } else if (mediaId === TAB_ARTISTS) {
    const artists = await getArtists();
    tree[mediaId] = artists.map((a) =>
      browsable(PREFIX_ARTIST + encodeURIComponent(a.artist), a.artist, undefined, a.coverPath ? (getArtworkUrl(a.coverPath, 256) ?? undefined) : undefined),
    );
  } else if (mediaId === TAB_FOLDERS) {
    const folders = await getFolders();
    tree[mediaId] = folders.map((f) =>
      browsable(PREFIX_FOLDER + encodeURIComponent(f.path), f.name, undefined, f.coverPath ? (getArtworkUrl(f.coverPath, 256) ?? undefined) : undefined),
    );
  } else if (mediaId.startsWith(PREFIX_ARTIST)) {
    const artist = decodeURIComponent(mediaId.slice(PREFIX_ARTIST.length));
    const albums = await getAlbums(artist);
    tree[mediaId] = albums.map((a) =>
      browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, 256) ?? undefined) : undefined),
    );
  } else if (mediaId.startsWith(PREFIX_ALBUM)) {
    const [artistEnc, albumEnc] = mediaId.slice(PREFIX_ALBUM.length).split(SEP);
    const artist = decodeURIComponent(artistEnc ?? '');
    const album = decodeURIComponent(albumEnc ?? '');
    const res = await getTracks({ album, artist, limit: 500 });
    tree[mediaId] = res.tracks.map(playableItem);
    recordTracks(mediaId, res.tracks);
  } else if (mediaId.startsWith(PREFIX_FOLDER)) {
    const folder = decodeURIComponent(mediaId.slice(PREFIX_FOLDER.length));
    const res = await getTracks({ folder, limit: 5000 });
    tree[mediaId] = res.tracks.map(playableItem);
    recordTracks(mediaId, res.tracks);
  } else {
    return; // unknown node
  }
  await push();
};

// Build the four root tabs and eagerly populate their first level so the car
// menu isn't empty on connect. Deeper nodes load lazily via remote-browse.
export const buildAndroidAutoTree = async (): Promise<void> => {
  if (!isAuthed()) return;
  tree[ROOT] = [
    browsable(TAB_PLAYED, 'Recently Played'),
    browsable(TAB_RECENT, 'Recently Added'),
    browsable(TAB_ARTISTS, 'Artists'),
    browsable(TAB_FOLDERS, 'Folders'),
  ];
  await push();
  const results = await Promise.allSettled([
    loadNode(TAB_PLAYED),
    loadNode(TAB_RECENT),
    loadNode(TAB_ARTISTS),
    loadNode(TAB_FOLDERS),
  ]);
  results.forEach((r) => {
    if (r.status === 'rejected') remoteLog('error', `[aa] root load failed — ${String(r.reason)}`);
  });
};

// Clear the tree on logout so a stale library isn't served to the car.
export const clearAndroidAutoTree = async (): Promise<void> => {
  for (const k of Object.keys(tree)) delete tree[k];
  trackByPath.clear();
  tracksByNode.clear();
  await push();
};

// Native emitted `remote-browse` for a node we haven't loaded.
export const handleAndroidAutoBrowse = async (mediaId: string): Promise<void> => {
  if (!mediaId || mediaId === ROOT || tree[mediaId]) return;
  if (!isAuthed()) return;
  try {
    await loadNode(mediaId);
  } catch (e) {
    remoteLog('error', `[aa] browse ${mediaId} failed — ${String(e)}`);
  }
};

// Native emitted `remote-play-id` — the user tapped a track in the car.
export const playAndroidAutoMediaId = async (mediaId: string): Promise<void> => {
  if (!mediaId) return;
  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  if (!isAuthed()) return;

  // Queue the siblings from whichever node this track was browsed in, if known.
  let queue: MusicTrack[] | undefined;
  for (const list of tracksByNode.values()) {
    if (list.some((t) => t.path === mediaId)) {
      queue = list;
      break;
    }
  }
  const startIndex = queue ? queue.findIndex((t) => t.path === mediaId) : 0;
  const tracks = queue ?? [trackByPath.get(mediaId) ?? playRecordToTrack({
    id: '', path: mediaId, playedAt: 0, title: '', artist: '', folder: '',
  })];
  const idx = startIndex >= 0 ? startIndex : 0;

  // Prefer the app's player so its queue/now-playing stay in sync.
  if (autoPlayHandler) {
    autoPlayHandler(tracks, idx);
    return;
  }
  // Headless fallback: drive TrackPlayer directly.
  try {
    const rntp = tracks.map((t) => ({
      url: getStreamUrl(t.path),
      title: getTrackTitle(t),
      artist: t.artist ?? undefined,
      album: t.album ?? undefined,
      artwork: t.hasArtwork ? (getArtworkUrl(t.path, 512) ?? undefined) : undefined,
      duration: t.duration ?? undefined,
    }));
    await TrackPlayer.setQueue(rntp);
    if (idx > 0) await TrackPlayer.skip(idx);
    await TrackPlayer.play();
  } catch (e) {
    remoteLog('error', `[aa] play ${mediaId} failed — ${String(e)}`);
  }
};
