// <copyright file="androidAuto.ts" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

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
import { ARTWORK_THUMB_SIZE, PLAYER_ART_SIZE } from './artworkCache';
import { getPlayHistory, type PlayRecord } from '../api/libraryActivity';
import {
  getLocalAlbums,
  getLocalAlbumTracks,
  getLocalFolders,
  getLocalFolderTracks,
  isLocalPath,
} from './localMusicLibrary';
import { useAuthStore } from '../store/auth';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
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
const TAB_LOCAL = 'aa:local';
const TAB_LOCAL_ALBUMS = 'aa:local:albums';
const TAB_LOCAL_FOLDERS = 'aa:local:folders';
const PREFIX_ARTIST = 'aa:artist:';
const PREFIX_ALBUM = 'aa:album:';
const PREFIX_FOLDER = 'aa:folder:';
const PREFIX_LOCAL_ALBUM = 'aa:local:album:';
const PREFIX_LOCAL_FOLDER = 'aa:local:folder:';
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
  iconUri: track.hasArtwork ? (getArtworkUrl(track.path, ARTWORK_THUMB_SIZE) ?? undefined) : undefined,
  mediaUri: getStreamUrl(track.path),
  playable: MediaItemPlayable.MediaPlayable,
});

// Local tracks use file:// URIs directly — no server stream URL or artwork endpoint.
const localPlayableItem = (track: MusicTrack): BrowseItem => ({
  mediaId: track.path,
  title: getTrackTitle(track),
  subtitle: track.artist ?? undefined,
  iconUri: track.hasArtwork ? (track.coverPath ?? undefined) : undefined,
  mediaUri: track.path,
  playable: MediaItemPlayable.MediaPlayable,
});

const trackPlayableItem = (track: MusicTrack): BrowseItem =>
  isLocalPath(track.path) ? localPlayableItem(track) : playableItem(track);

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
  coverPath: null,
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
    await TrackPlayer.setBrowseTree(tree as Record<string, Record<string, unknown>[]>);
  } catch (e) {
    remoteLog('error', `[aa] setBrowseTree failed — ${String(e)}`);
  }
};

const loadNode = async (mediaId: string): Promise<void> => {
  if (mediaId === TAB_PLAYED) {
    const history = await getPlayHistory(50);
    const stubs = history.map(playRecordToTrack);
    tree[mediaId] = stubs.map(trackPlayableItem);
    recordTracks(mediaId, stubs);
  } else if (mediaId === TAB_RECENT) {
    const albums = await getRecentlyAdded(30);
    tree[mediaId] = albums.map((a) =>
      browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    );
  } else if (mediaId === TAB_ARTISTS) {
    const artists = await getArtists();
    tree[mediaId] = artists.map((a) =>
      browsable(PREFIX_ARTIST + encodeURIComponent(a.artist), a.artist, undefined, a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    );
  } else if (mediaId === TAB_FOLDERS) {
    const folders = await getFolders();
    tree[mediaId] = folders.map((f) =>
      browsable(PREFIX_FOLDER + encodeURIComponent(f.path), f.name, undefined, f.coverPath ? (getArtworkUrl(f.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    );
  } else if (mediaId.startsWith(PREFIX_ARTIST)) {
    const artist = decodeURIComponent(mediaId.slice(PREFIX_ARTIST.length));
    const albums = await getAlbums(artist);
    tree[mediaId] = albums.map((a) =>
      browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
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
  } else if (mediaId === TAB_LOCAL) {
    tree[mediaId] = [
      browsable(TAB_LOCAL_ALBUMS, 'Albums'),
      browsable(TAB_LOCAL_FOLDERS, 'Folders'),
    ];
  } else if (mediaId === TAB_LOCAL_ALBUMS) {
    const albums = await getLocalAlbums();
    tree[mediaId] = albums.map((a) =>
      browsable(PREFIX_LOCAL_ALBUM + encodeURIComponent(a.album), a.album, a.artist || undefined),
    );
  } else if (mediaId === TAB_LOCAL_FOLDERS) {
    const folders = await getLocalFolders();
    tree[mediaId] = folders.map((f) =>
      browsable(PREFIX_LOCAL_FOLDER + encodeURIComponent(f.path), f.name, undefined, f.coverPath ?? undefined),
    );
  } else if (mediaId.startsWith(PREFIX_LOCAL_ALBUM)) {
    const album = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_ALBUM.length));
    const tracks = await getLocalAlbumTracks(album);
    tree[mediaId] = tracks.map(localPlayableItem);
    recordTracks(mediaId, tracks);
  } else if (mediaId.startsWith(PREFIX_LOCAL_FOLDER)) {
    const folder = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_FOLDER.length));
    const tracks = await getLocalFolderTracks(folder);
    tree[mediaId] = tracks.map(localPlayableItem);
    recordTracks(mediaId, tracks);
  } else {
    return; // unknown node
  }
  await push();
};

// Build the four root tabs and eagerly populate their first level so the car
// menu isn't empty on connect. Deeper nodes load lazily via remote-browse.
export const buildAndroidAutoTree = async (): Promise<void> => {
  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  if (!isAuthed()) return;
  tree[ROOT] = [
    browsable(TAB_PLAYED, 'Recently Played'),
    browsable(TAB_RECENT, 'Recently Added'),
    browsable(TAB_ARTISTS, 'Artists'),
    browsable(TAB_FOLDERS, 'Folders'),
    browsable(TAB_LOCAL, 'On Device'),
  ];
  await push();
  const results = await Promise.allSettled([
    loadNode(TAB_PLAYED),
    loadNode(TAB_RECENT),
    loadNode(TAB_ARTISTS),
    loadNode(TAB_FOLDERS),
    loadNode(TAB_LOCAL),
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
  if (!mediaId) return;
  // Hydrate auth if running headless (app UI not mounted).
  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  if (!isAuthed()) return;

  if (mediaId === ROOT) {
    // Car opened the root — build the tree on first connect (handles headless startup).
    if (!tree[ROOT]) {
      try {
        await buildAndroidAutoTree();
      } catch (e) {
        remoteLog('error', `[aa] root build failed — ${String(e)}`);
      }
    }
    return;
  }
  if (tree[mediaId]) return;
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
    id: '', path: mediaId, playedAt: 0, title: '', artist: '', folder: '', source: '',
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
      url: isLocalPath(t.path) ? t.path : getStreamUrl(t.path),
      title: getTrackTitle(t),
      artist: t.artist ?? undefined,
      album: t.album ?? undefined,
      artwork: isLocalPath(t.path)
        ? (t.coverPath ?? undefined)
        : (t.hasArtwork ? (getArtworkUrl(t.path, PLAYER_ART_SIZE) ?? undefined) : undefined),
      duration: t.duration ?? undefined,
      _source: t,
    }));
    await TrackPlayer.setQueue(rntp);
    if (idx > 0) await TrackPlayer.skip(idx);
    await TrackPlayer.play();
  } catch (e) {
    remoteLog('error', `[aa] play ${mediaId} failed — ${String(e)}`);
  }
};

// Native emitted `remote-love` — the user tapped the heart button in the car.
export const handleAndroidAutoLove = async (): Promise<void> => {
  try {
    const rntpTrack = await TrackPlayer.getActiveTrack();
    const path: string | undefined = (rntpTrack as any)?._source?.path ?? (rntpTrack as any)?._path;
    if (!path) return;
    await useLibraryActivityStore.getState().toggleLove(path);
  } catch (e) {
    remoteLog('error', `[aa] love failed — ${String(e)}`);
  }
};
