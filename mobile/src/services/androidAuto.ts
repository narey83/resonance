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
import { contentTypeFor } from '../lib/mimeTypes';
import {
  getAlbums,
  getArtists,
  getFolders,
  getGenres,
  getLovedTracks,
  getTracks,
  getYears,
  getArtworkUrl,
  getStreamUrl,
  getTrackTitle,
  type MusicTrack,
  type MusicAlbum,
} from '../api/musicLibrary';
import { ARTWORK_THUMB_SIZE, PLAYER_ART_SIZE } from './artworkCache';
import { type PlayRecord } from '../api/libraryActivity';
import * as mixtapes from '../api/mixtapes';
import type { MixtapeTrack } from '../api/mixtapes';
import {
  getAllLocalTracks,
  getLocalAlbums,
  getLocalAlbumTracks,
  getLocalArtists,
  getLocalArtistAlbums,
  getLocalArtistTracks,
  getLocalFolders,
  getLocalFolderTracks,
  getLocalGenres,
  getLocalGenreTracks,
  getLocalYears,
  getLocalYearTracks,
  isLocalPath,
} from './localMusicLibrary';
import { useAuthStore } from '../store/auth';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { useLocalLibraryActivityStore } from '../store/localLibraryActivityStore';
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
  // Root tabs only: suppress the artwork placeholder. The car renders a tab's icon as a plain
  // grey square when it can't use the image, which looked like a broken box above every label.
  noIcon?: string;
  playable: string;
};
type BrowseTree = Record<string, BrowseItem[]>;

const ROOT = '/';
const TAB_SERVER = 'aa:server';
const TAB_ARTISTS = 'aa:artists';
const TAB_TRACKS = 'aa:tracks';
const TAB_ALBUMS = 'aa:albums';
const TAB_GENRES = 'aa:genres';
const TAB_YEARS = 'aa:years';
const TAB_MIXTAPES = 'aa:mixtapes';
const TAB_LOVED = 'aa:loved';
const TAB_FOLDERS = 'aa:folders';
const TAB_LOCAL = 'aa:local';
const TAB_LOCAL_ARTISTS = 'aa:local:artists';
const TAB_LOCAL_ALBUMS = 'aa:local:albums';
const TAB_LOCAL_TRACKS = 'aa:local:tracks';
const TAB_LOCAL_FOLDERS = 'aa:local:folders';
const TAB_LOCAL_GENRES = 'aa:local:genres';
const TAB_LOCAL_YEARS = 'aa:local:years';
const TAB_LOCAL_LOVED = 'aa:local:loved';
const TAB_LOCAL_HISTORY = 'aa:local:history';
const PREFIX_FOLDER = 'aa:folder:';
const PREFIX_ARTIST = 'aa:artist:';
const PREFIX_ALBUM = 'aa:album:';   // aa:album:<artist>|<album>, both URI-encoded
const PREFIX_GENRE = 'aa:genre:';
const PREFIX_YEAR = 'aa:year:';
const PREFIX_MIXTAPE = 'aa:mixtape:';
const PREFIX_LOCAL_ALBUM = 'aa:local:album:';
const PREFIX_LOCAL_FOLDER = 'aa:local:folder:';
const PREFIX_LOCAL_ARTIST = 'aa:local:artist:';
const PREFIX_LOCAL_GENRE = 'aa:local:genre:';
const PREFIX_LOCAL_YEAR = 'aa:local:year:';

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

// The car can open the browser before the session exists — it cold-starts the app itself, and on
// a phone that was rebooted or force-stopped the token isn't restored yet. Returning empty there
// left every menu permanently blank (confirmed on the head unit 2026-08-06: the app made no API
// calls at all), because the car only re-asks for a node if the user backs out and re-enters.
// So park the request and build the tree the moment a session appears.
let waitingForAuth = false;
// Nodes the car asked for while we had no session. The car does not ask twice, so these have to
// be loaded as soon as one appears or they stay empty until it reconnects.
const deferredBrowses = new Set<string>();
const buildWhenAuthed = () => {
  if (waitingForAuth) return;
  waitingForAuth = true;
  remoteLog('info', '[aa] browse before sign-in — deferring tree build until a session exists');
  const unsubscribe = useAuthStore.subscribe(() => {
    if (!isAuthed()) return;
    unsubscribe();
    waitingForAuth = false;
    buildAndroidAutoTree()
      .then(async () => {
        const pending = [...deferredBrowses];
        deferredBrowses.clear();
        for (const id of pending) await loadNode(id).catch(() => { /* node may no longer exist */ });
      })
      .catch((e) => remoteLog('error', `[aa] deferred build failed — ${String(e)}`));
  });
};

const browsable = (
  mediaId: string,
  title: string,
  subtitle?: string,
  iconUri?: string,
): BrowseItem => ({ mediaId, title, subtitle, iconUri, playable: MediaItemPlayable.MediaBrowsable });

// Tab titles are truncated hard by the car ("Recently Pla…"), so they have to be short.
const tab = (mediaId: string, title: string): BrowseItem => ({
  ...browsable(mediaId, title),
  noIcon: '1',
});

const playableItem = (track: MusicTrack): BrowseItem => ({
  mediaId: track.path,
  title: getTrackTitle(track),
  subtitle: track.artist ?? undefined,
  iconUri: track.hasArtwork ? (getArtworkUrl(track.path, ARTWORK_THUMB_SIZE) ?? undefined) : undefined,
  playable: MediaItemPlayable.MediaPlayable,
});

// Local tracks use file:// URIs directly — no server stream URL or artwork endpoint.
const localPlayableItem = (track: MusicTrack): BrowseItem => ({
  mediaId: track.path,
  title: getTrackTitle(track),
  subtitle: track.artist ?? undefined,
  iconUri: track.hasArtwork ? (track.coverPath ?? undefined) : undefined,
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
  coverPath: null,
  genre: null,
  bpm: null,
  key: null,
  fileSize: null,
});

// A MixtapeTrack carries only what the mixtape stored; enough to queue and stream.
const mixtapeTrackToTrack = (t: MixtapeTrack): MusicTrack => ({
  path: t.filePath,
  filename: t.filePath.split(/[/\\]/).pop() ?? t.filePath,
  directory: '',
  duration: t.duration,
  title: t.title,
  artist: t.artist,
  albumArtist: null,
  album: t.album,
  year: null,
  trackNumber: null,
  discNumber: null,
  hasArtwork: true, // resolved by path against the artwork endpoint
  coverPath: null,
  genre: null,
  bpm: null,
  key: null,
  fileSize: null,
});

const albumNodeId = (a: MusicAlbum) =>
  `${PREFIX_ALBUM}${encodeURIComponent(a.albumArtist ?? a.artist)}|${encodeURIComponent(a.album)}`;
const localAlbumNodeId = (a: MusicAlbum) => `${PREFIX_LOCAL_ALBUM}${encodeURIComponent(a.album)}`;

// A local PlayRecord carries no coverPath, and local artwork is rendered straight from
// track.coverPath (no server URL to resolve it from) — so unlike playRecordToTrack, hasArtwork
// must stay false rather than best-effort true.
const localPlayRecordToTrack = (r: PlayRecord): MusicTrack => ({
  ...playRecordToTrack(r),
  hasArtwork: false,
});

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

// Android Auto will not scroll a very long browse list: the 14,277-artist node rendered its
// first screen and then ignored every scroll (reproduced on the Desktop Head Unit 2026-08-06,
// while a 100-track folder scrolled fine). Any node longer than this is served as ranged
// sub-nodes — recursively, so a list of ranges can't get too long either.
// The ceiling sits between 288 and 500: a 288-genre list renders and scrolls, while a 500-item
// list is delivered to the car (have=500 in the log) and then drawn as "No items". 300 keeps
// whole categories (288 genres, 46 years, 70 folders) in one list without going near it.
const LIST_MAX = 300;
const PREFIX_CHUNK = 'aa:chunk:';
// aa:page:<offset>:<kind>:<key> — self-describing so a page still resolves after a restart.
// kind: f=folder, g=genre, y=year, a=all tracks.
const PREFIX_PAGE = 'aa:page:';
const chunkChildren = new Map<string, BrowseItem[]>();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const rangeLabel = (items: BrowseItem[]): string => {
  const trim = (t: string) => (t.length > 16 ? `${t.slice(0, 16).trimEnd()}…` : t);
  return `${trim(items[0].title)} – ${trim(items[items.length - 1].title)}`;
};

const chunked = (nodeId: string, items: BrowseItem[]): BrowseItem[] => {
  if (items.length <= LIST_MAX) return items;
  const groups: BrowseItem[] = [];
  for (let i = 0; i < items.length; i += LIST_MAX) {
    const slice = items.slice(i, i + LIST_MAX);
    const id = `${PREFIX_CHUNK}${i}:${nodeId}`;
    chunkChildren.set(id, slice);
    groups.push(browsable(id, rangeLabel(slice), plural(slice.length, 'item')));
  }
  return chunked(`${nodeId}:g`, groups);
};

const pageQuery = (kind: string, key: string): Record<string, string | number> => {
  if (kind === 'f') return { folder: decodeURIComponent(key) };
  if (kind === 'g') return { genre: decodeURIComponent(key) };
  if (kind === 'y') return { year: Number(key) };
  return {};
};

// Serve a track query as one list if it fits, or as numbered pages that fetch on demand. The
// biggest folder here holds 24,935 tracks, so nothing may assume it can hold a whole list.
const loadTracks = async (nodeId: string, kind: string, key: string): Promise<void> => {
  const query = pageQuery(kind, key);
  const res = await getTracks({ ...query, limit: LIST_MAX });
  if (res.total > res.tracks.length) {
    const pages: BrowseItem[] = [];
    for (let off = 0; off < res.total; off += LIST_MAX) {
      pages.push(browsable(
        `${PREFIX_PAGE}${off}:${kind}:${key}`,
        `${off + 1} – ${Math.min(off + LIST_MAX, res.total)}`,
        `of ${res.total}`,
      ));
    }
    tree[nodeId] = chunked(nodeId, pages);
  } else {
    tree[nodeId] = chunked(nodeId, res.tracks.map(playableItem));
    recordTracks(nodeId, res.tracks);
  }
};

const loadNode = async (mediaId: string): Promise<void> => {
  if (mediaId.startsWith(PREFIX_CHUNK)) {
    // A chunk's contents live in memory, but the car remembers where it was and asks for one
    // directly after a restart — which used to answer empty for good. The id carries its parent
    // (aa:chunk:<offset>:<parentId>, with :g per grouping level), so rebuild the parent: chunking
    // is deterministic, so that regenerates this exact id.
    if (!chunkChildren.has(mediaId)) {
      const parentId = mediaId.slice(mediaId.indexOf(':', PREFIX_CHUNK.length) + 1);
      await loadNode(parentId.replace(/(:g)+$/, ''));
    }
    tree[mediaId] = chunkChildren.get(mediaId) ?? [];
    await push();
    return;
  }
  if (mediaId === TAB_SERVER) {
    // Same views as the phone's Library screen.
    tree[mediaId] = [
      browsable(TAB_ARTISTS, 'Artists'),
      browsable(TAB_ALBUMS, 'Albums'),
      browsable(TAB_TRACKS, 'Tracks'),
      browsable(TAB_FOLDERS, 'Folders'),
      browsable(TAB_GENRES, 'Genres'),
      browsable(TAB_YEARS, 'Years'),
      browsable(TAB_MIXTAPES, 'Mixtapes'),
      browsable(TAB_LOVED, 'Loved'),
    ];
  } else if (mediaId === TAB_ARTISTS) {
    const artists = await getArtists();
    tree[mediaId] = chunked(mediaId, artists.map((a) =>
      browsable(PREFIX_ARTIST + encodeURIComponent(a.artist), a.artist, plural(a.trackCount, 'track'), a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    ));
  } else if (mediaId === TAB_ALBUMS) {
    const albums = await getAlbums();
    tree[mediaId] = chunked(mediaId, albums.map((a) =>
      browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    ));
  } else if (mediaId === TAB_TRACKS) {
    await loadTracks(mediaId, 'a', '');
  } else if (mediaId === TAB_GENRES) {
    const genres = await getGenres();
    tree[mediaId] = chunked(mediaId, genres.map((g) =>
      browsable(PREFIX_GENRE + encodeURIComponent(g.genre), g.genre, plural(g.trackCount, 'track')),
    ));
  } else if (mediaId === TAB_YEARS) {
    const years = await getYears();
    tree[mediaId] = chunked(mediaId, years.map((y) =>
      browsable(PREFIX_YEAR + y.year, String(y.year), plural(y.trackCount, 'track')),
    ));
  } else if (mediaId === TAB_MIXTAPES) {
    const all = await mixtapes.getAll();
    tree[mediaId] = chunked(mediaId, all.map((m) =>
      browsable(PREFIX_MIXTAPE + encodeURIComponent(m.id), m.name, plural(m.tracks.length, 'track'), m.hasArtwork ? (mixtapes.getMixtapeArtworkUrl(m.id) ?? undefined) : undefined),
    ));
  } else if (mediaId === TAB_LOVED) {
    const loved = await getLovedTracks();
    tree[mediaId] = chunked(mediaId, loved.map(playableItem));
    recordTracks(mediaId, loved);
  } else if (mediaId === TAB_FOLDERS) {
    const folders = await getFolders();
    tree[mediaId] = chunked(mediaId, folders.map((f) =>
      browsable(PREFIX_FOLDER + encodeURIComponent(f.path), f.name, plural(f.trackCount, 'track'), f.coverPath ? (getArtworkUrl(f.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
    ));
  } else if (mediaId.startsWith(PREFIX_ARTIST)) {
    const artist = decodeURIComponent(mediaId.slice(PREFIX_ARTIST.length));
    const albums = await getAlbums(artist);
    if (albums.length === 0) {
      // An artist whose tracks carry no album tag has no albums to show — a dead end in the car.
      // Show the tracks themselves instead.
      const res = await getTracks({ artist, limit: LIST_MAX });
      tree[mediaId] = chunked(mediaId, res.tracks.map(playableItem));
      recordTracks(mediaId, res.tracks);
    } else {
      tree[mediaId] = chunked(mediaId, albums.map((a) =>
        browsable(albumNodeId(a), a.album, a.artist, a.coverPath ? (getArtworkUrl(a.coverPath, ARTWORK_THUMB_SIZE) ?? undefined) : undefined),
      ));
    }
  } else if (mediaId.startsWith(PREFIX_ALBUM)) {
    const [artistEnc, albumEnc] = mediaId.slice(PREFIX_ALBUM.length).split('|');
    const res = await getTracks({
      artist: decodeURIComponent(artistEnc ?? ''),
      album: decodeURIComponent(albumEnc ?? ''),
      limit: LIST_MAX,
    });
    tree[mediaId] = chunked(mediaId, res.tracks.map(playableItem));
    recordTracks(mediaId, res.tracks);
  } else if (mediaId.startsWith(PREFIX_GENRE)) {
    await loadTracks(mediaId, 'g', mediaId.slice(PREFIX_GENRE.length));
  } else if (mediaId.startsWith(PREFIX_YEAR)) {
    await loadTracks(mediaId, 'y', mediaId.slice(PREFIX_YEAR.length));
  } else if (mediaId.startsWith(PREFIX_MIXTAPE)) {
    const mixtape = await mixtapes.getById(decodeURIComponent(mediaId.slice(PREFIX_MIXTAPE.length)));
    const tracks = mixtape.tracks.map(mixtapeTrackToTrack);
    tree[mediaId] = chunked(mediaId, tracks.map(playableItem));
    recordTracks(mediaId, tracks);
  } else if (mediaId.startsWith(PREFIX_FOLDER)) {
    await loadTracks(mediaId, 'f', mediaId.slice(PREFIX_FOLDER.length));
  } else if (mediaId.startsWith(PREFIX_PAGE)) {
    const [offStr, kind, ...keyParts] = mediaId.slice(PREFIX_PAGE.length).split(':');
    const res = await getTracks({
      ...pageQuery(kind, keyParts.join(':')),
      offset: Number(offStr),
      limit: LIST_MAX,
    });
    tree[mediaId] = chunked(mediaId, res.tracks.map(playableItem));
    recordTracks(mediaId, res.tracks);
  } else if (mediaId === TAB_LOCAL) {
    // Same views as the phone's local Library tabs, minus Mixtapes (server-only).
    tree[mediaId] = [
      browsable(TAB_LOCAL_ARTISTS, 'Artists'),
      browsable(TAB_LOCAL_ALBUMS, 'Albums'),
      browsable(TAB_LOCAL_TRACKS, 'Tracks'),
      browsable(TAB_LOCAL_FOLDERS, 'Folders'),
      browsable(TAB_LOCAL_GENRES, 'Genres'),
      browsable(TAB_LOCAL_YEARS, 'Years'),
      browsable(TAB_LOCAL_LOVED, 'Loved'),
      browsable(TAB_LOCAL_HISTORY, 'History'),
    ];
  } else if (mediaId === TAB_LOCAL_ARTISTS) {
    const artists = await getLocalArtists();
    tree[mediaId] = chunked(mediaId, artists.map((a) =>
      browsable(PREFIX_LOCAL_ARTIST + encodeURIComponent(a.artist), a.artist, plural(a.trackCount, 'track'), a.coverPath ?? undefined),
    ));
  } else if (mediaId === TAB_LOCAL_ALBUMS) {
    const albums = await getLocalAlbums();
    tree[mediaId] = chunked(mediaId, albums.map((a) =>
      browsable(localAlbumNodeId(a), a.album, a.artist || undefined, a.coverPath ?? undefined),
    ));
  } else if (mediaId === TAB_LOCAL_TRACKS) {
    const tracks = await getAllLocalTracks();
    tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
    recordTracks(mediaId, tracks);
  } else if (mediaId === TAB_LOCAL_FOLDERS) {
    const folders = await getLocalFolders();
    tree[mediaId] = chunked(mediaId, folders.map((f) =>
      browsable(PREFIX_LOCAL_FOLDER + encodeURIComponent(f.path), f.name, undefined, f.coverPath ?? undefined),
    ));
  } else if (mediaId === TAB_LOCAL_GENRES) {
    const genres = await getLocalGenres();
    tree[mediaId] = chunked(mediaId, genres.map((g) =>
      browsable(PREFIX_LOCAL_GENRE + encodeURIComponent(g.genre), g.genre, plural(g.trackCount, 'track')),
    ));
  } else if (mediaId === TAB_LOCAL_YEARS) {
    const years = await getLocalYears();
    tree[mediaId] = chunked(mediaId, years.map((y) =>
      browsable(PREFIX_LOCAL_YEAR + y.year, String(y.year), plural(y.trackCount, 'track')),
    ));
  } else if (mediaId === TAB_LOCAL_LOVED) {
    await useLocalLibraryActivityStore.getState().load();
    const { lovedPaths } = useLocalLibraryActivityStore.getState();
    const byPath = new Map((await getAllLocalTracks()).map((t) => [t.path, t]));
    const loved = [...lovedPaths].map((p) => byPath.get(p)).filter((t): t is MusicTrack => !!t);
    tree[mediaId] = chunked(mediaId, loved.map(localPlayableItem));
    recordTracks(mediaId, loved);
  } else if (mediaId === TAB_LOCAL_HISTORY) {
    await useLocalLibraryActivityStore.getState().load();
    const { recentPlays } = useLocalLibraryActivityStore.getState();
    const byPath = new Map((await getAllLocalTracks()).map((t) => [t.path, t]));
    const history = recentPlays.map((r) => byPath.get(r.path) ?? localPlayRecordToTrack(r));
    tree[mediaId] = chunked(mediaId, history.map(localPlayableItem));
    recordTracks(mediaId, history);
  } else if (mediaId.startsWith(PREFIX_LOCAL_ARTIST)) {
    const artist = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_ARTIST.length));
    const albums = await getLocalArtistAlbums(artist);
    if (albums.length === 0) {
      // Same untagged-artist fallback as the server tree: no album tag means no album nodes.
      const tracks = await getLocalArtistTracks(artist);
      tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
      recordTracks(mediaId, tracks);
    } else {
      tree[mediaId] = chunked(mediaId, albums.map((a) =>
        browsable(localAlbumNodeId(a), a.album, a.artist, a.coverPath ?? undefined),
      ));
    }
  } else if (mediaId.startsWith(PREFIX_LOCAL_ALBUM)) {
    const album = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_ALBUM.length));
    const tracks = await getLocalAlbumTracks(album);
    tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
    recordTracks(mediaId, tracks);
  } else if (mediaId.startsWith(PREFIX_LOCAL_FOLDER)) {
    const folder = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_FOLDER.length));
    const tracks = await getLocalFolderTracks(folder);
    tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
    recordTracks(mediaId, tracks);
  } else if (mediaId.startsWith(PREFIX_LOCAL_GENRE)) {
    const genre = decodeURIComponent(mediaId.slice(PREFIX_LOCAL_GENRE.length));
    const tracks = await getLocalGenreTracks(genre);
    tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
    recordTracks(mediaId, tracks);
  } else if (mediaId.startsWith(PREFIX_LOCAL_YEAR)) {
    const tracks = await getLocalYearTracks(Number(mediaId.slice(PREFIX_LOCAL_YEAR.length)));
    tree[mediaId] = chunked(mediaId, tracks.map(localPlayableItem));
    recordTracks(mediaId, tracks);
  } else {
    return; // unknown node
  }
  await push();
};

// Build the four root tabs and eagerly populate their first level so the car
// menu isn't empty on connect. Deeper nodes load lazily via remote-browse.
export const buildAndroidAutoTree = async (): Promise<void> => {
  // The tabs are static, so publish them before doing anything that can block. The car asks for
  // the root the instant it connects and keeps whatever it gets: answer that first request with an
  // empty list — because we were still hydrating the session — and it shows "No items" until the
  // next connection, no matter what we notify afterwards.
  tree[ROOT] = [
    tab(TAB_SERVER, 'Music from Server'),
    tab(TAB_LOCAL, 'Music on Device'),
  ];
  await push();

  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  if (!isAuthed()) { buildWhenAuthed(); return; }
  const results = await Promise.allSettled([
    loadNode(TAB_SERVER),
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

// Release a request the car is holding when we cannot fill it. An unanswered or empty answer is
// remembered by the car for the whole session; a failure is not, so it will ask again.
const reportBrowseFailed = async (mediaId: string, why: string): Promise<void> => {
  remoteLog('warn', `[aa] browse ${mediaId} unresolved (${why}) — failing the car's request`);
  delete tree[mediaId]; // never leave an empty node behind: it would stop native asking us again
  try {
    await (TrackPlayer as unknown as { browseFailed: (id: string) => Promise<string> })
      .browseFailed(mediaId);
  } catch (e) {
    remoteLog('error', `[aa] browseFailed(${mediaId}) errored — ${String(e)}`);
  }
};

// Native emitted `remote-browse` for a node we haven't loaded.
export const handleAndroidAutoBrowse = async (mediaId: string): Promise<void> => {
  if (!mediaId) return;
  // Hydrate auth if running headless (app UI not mounted).
  if (mediaId === ROOT && !tree[ROOT]) {
    try {
      await buildAndroidAutoTree();
    } catch (e) {
      remoteLog('error', `[aa] root build failed — ${String(e)}`);
    }
    return;
  }

  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  if (!isAuthed()) {
    if (mediaId !== ROOT) {
      deferredBrowses.add(mediaId);
      // Fail the held request rather than making the car wait on a session that may be minutes
      // away; the replay below repopulates the node so the next open is instant.
      await reportBrowseFailed(mediaId, 'no session yet');
    }
    buildWhenAuthed();
    return;
  }

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
  if (tree[mediaId]?.length) return;

  // The car holds this request open until we answer it, so every path out of here must resolve it:
  // loadNode pushes the tree on success, and browseFailed releases it on failure. Falling through
  // silently would leave the car waiting on the watchdog.
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await loadNode(mediaId);
      const count = tree[mediaId]?.length ?? 0;
      remoteLog('info', `[aa] browse ${mediaId} -> ${count} items in ${Date.now() - startedAt}ms`);
      if (count === 0) await reportBrowseFailed(mediaId, 'loaded but empty');
      return;
    } catch (e) {
      remoteLog(attempt === 0 ? 'warn' : 'error', `[aa] browse ${mediaId} failed (attempt ${attempt + 1}, ${Date.now() - startedAt}ms) — ${String(e)}`);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
    }
  }
  await reportBrowseFailed(mediaId, 'load failed');
};

// Native emitted `remote-play-id` — the user tapped a track in the car.
export const playAndroidAutoMediaId = async (mediaId: string): Promise<void> => {
  if (!mediaId) return;
  const auth = useAuthStore.getState();
  if (!auth.isReady) await auth.hydrate();
  // On-device files play straight off disk — only server paths need a session. Native no longer
  // hands the browse item to the player itself, so bailing here would mean silence, not a fallback.
  if (!isLocalPath(mediaId) && !isAuthed()) return;

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
      contentType: contentTypeFor(t.path),
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
    const store = isLocalPath(path) ? useLocalLibraryActivityStore : useLibraryActivityStore;
    await store.getState().toggleLove(path);
  } catch (e) {
    remoteLog('error', `[aa] love failed — ${String(e)}`);
  }
};
