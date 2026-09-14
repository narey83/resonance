// <copyright file="PlayerContext.tsx" company="John Narey">
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

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import TrackPlayer, {
  Event,
  RepeatMode,
  State,
  Track,
  useActiveTrack,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import { AppState } from 'react-native';
import { MusicTrack, getArtworkUrl, getStreamUrl, getTrackTitle, currentStreamQuality } from '../api/musicLibrary';
import { getArtworkCacheKey, prefetchArtwork, PLAYER_ART_SIZE } from '../services/artworkCache';
import { isLocalPath } from '../services/localMusicLibrary';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { useLocalLibraryActivityStore } from '../store/localLibraryActivityStore';
import { usePlayerUI } from '../store/playerUIStore';
import { useConnectionStore } from '../services/connectionMonitor';
import { useAuthStore } from '../store/auth';
import { ensureSigned, getSignature, invalidateSignatures, isSigned } from '../api/streamSignatures';
import { remoteLog } from '../api/remoteLogger';
import { recordMediaLoad } from '../store/networkLogStore';
import {
  buildAndroidAutoTree,
  clearAndroidAutoTree,
  registerAutoPlayHandler,
} from '../services/androidAuto';
import { ensurePlayerSetup, buildPlayerOptions } from '../services/playerSetup';
import { promptBatteryExemptionOnce } from '../services/batteryOptimization';
import { contentTypeFor } from '../lib/mimeTypes';

// ── Types ──────────────────────────────────────────────────────────────────────

export type RepeatSetting = 'off' | 'queue' | 'track';

interface PlayerContextValue {
  track: MusicTrack | null;
  queue: MusicTrack[];
  queueIndex: number;
  shuffle: boolean;
  repeatMode: RepeatSetting;
  cycleRepeat: () => void;
  playTrack: (track: MusicTrack) => void;
  playQueue: (tracks: MusicTrack[], startIndex?: number) => void;
  addToQueue: (tracks: MusicTrack[]) => void;
  clearQueue: () => void;
  stopPlayer: () => Promise<void>;
  playNext: (tracks: MusicTrack[]) => void;
  skipToIndex: (idx: number) => Promise<void>;
  pause: () => void;
  togglePlayPause: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (seconds: number) => void;
  toggleShuffle: () => void;
  setSuppressLocalPlay: (suppress: boolean) => void;
  restoreTrack: (track: MusicTrack) => void;
}

interface PlaybackStatusContextValue {
  isPlaying: boolean;
  isBuffering: boolean;
  durationSec: number;
}

// Split out from status: position ticks ~4×/sec (useProgress(250)), so keeping it
// in its own context means only components that render the moving position (mini-bar
// progress strip, expanded player seek bar) re-render on each tick — not every
// isPlaying/duration consumer, which would otherwise churn the always-mounted tab bar.
interface PlaybackPositionContextValue {
  positionSec: number;
  durationSec: number;
}

const PlayerContext         = createContext<PlayerContextValue | null>(null);
const PlaybackStatusContext = createContext<PlaybackStatusContextValue>({
  isPlaying: false, isBuffering: false, durationSec: 0,
});
const PlaybackPositionContext = createContext<PlaybackPositionContextValue>({
  positionSec: 0, durationSec: 0,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

type RntpTrack = Track & { _source: MusicTrack };

const toRntpTrack = (track: MusicTrack): RntpTrack => {
  const isLocal = isLocalPath(track.path);
  return {
    url:         isLocal ? track.path : getStreamUrl(track.path),
    title:       getTrackTitle(track),
    artist:      track.artist    ?? undefined,
    album:       track.album     ?? undefined,
    artwork:     track.hasArtwork ? (isLocal ? track.coverPath ?? undefined : getArtworkUrl(track.path, PLAYER_ART_SIZE) ?? undefined) : undefined,
    duration:    track.duration  ?? undefined,
    // On a metered/slow connection the server transcodes to MP3, so the file's own extension is
    // the wrong label — declaring audio/flac for MPEG bytes makes the player fail to open the
    // stream. That is why FLAC played on Wi-Fi and died on mobile data.
    contentType: isLocal || currentStreamQuality() === 'original'
      ? contentTypeFor(track.path)
      : 'audio/mpeg',
    _source:     track,
  } as RntpTrack;
};

const fromRntpTrack = (t: Track | undefined | null): MusicTrack | null =>
  t ? ((t as RntpTrack)._source ?? null) : null;

// ponytail: hard queue cap. "Play All" over a 46k-track library used to hand every track to
// TrackPlayer.setQueue in one bridge call (plus a 46k-path sign request) and froze the app.
// Lowered 500 -> 200 for Android Auto: the car's queue view is stricter than its browse lists —
// a 300-item queue renders but snaps back to the top instead of scrolling (reported from the
// head unit 2026-08-07), while a 300-row browse list scrolls fine. 200 is still ~13h.
export const MAX_QUEUE = 200;
export const LEAD_IN = 50; // kept before the tapped track so Previous still has somewhere to go

// Window a too-long track list around the tapped index. Returns [tracks, index].
const windowQueue = (tracks: MusicTrack[], startIndex: number): [MusicTrack[], number] => {
  const start = Math.max(0, Math.min(startIndex, tracks.length - 1));
  if (tracks.length <= MAX_QUEUE) return [tracks, start];
  const from = Math.max(0, Math.min(start - LEAD_IN, tracks.length - MAX_QUEUE));
  return [tracks.slice(from, from + MAX_QUEUE), start - from];
};

const buildShuffleOrder = (length: number, startIndex: number): number[] => {
  const indices = Array.from({ length }, (_, i) => i).filter((i) => i !== startIndex);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return [startIndex, ...indices];
};

// How many tracks on each side of the current one to prefetch artwork for.
const PREFETCH_RADIUS = 2;

// Auto-retry budget for a remote stream that errors while foregrounded (transient server 5xx, e.g.
// the backend briefly 502ing during a restart, or a network blip). Exponential backoff capped at
// 20s gives ~60s of total retrying before giving up — long enough to outlast a server restart,
// short enough that a genuinely missing file doesn't loop forever.
const STREAM_RETRY_MAX = 6;

// How many mid-track buffer starvations, within how long, before concluding the link cannot
// sustain a full-quality stream -- and how long it must then behave before the verdict lifts.
// Two stalls rather than one so a single blip costs nothing; a recovery window comfortably
// longer than the window itself so quality does not oscillate at the boundary.
const STALL_LIMIT        =       2;
const STALL_WINDOW_MS    =  60_000;
const STALL_RECOVERY_MS  = 180_000;
const streamRetryDelayMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 20_000);

// How much of the next track to pull early, and how long to wait before doing it. 512KB covers
// several seconds of even a lossless stream -- enough that the server has found the file and its
// head is cached, which is the part that costs. The delay keeps the request off the back of a
// skip: while someone is flicking through tracks the effect re-runs and cancels, so only landing
// on a track for longer than this spends anything.
const STREAM_PREFETCH_BYTES    = 512 * 1024;
const STREAM_PREFETCH_DELAY_MS = 2_000;

// ── Provider ───────────────────────────────────────────────────────────────────

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // Local queue state — keeps MusicTrack objects without round-tripping through RNTP
  const [queue, setQueue]           = useState<MusicTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffle, setShuffle]       = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [repeatMode, setRepeatMode] = useState<RepeatSetting>('off');

  const suppressLocalPlayRef = useRef(false);
  const positionRef          = useRef(0);
  const playingRef           = useRef(false);
  // Path of the track we last auto-recovered from a stale-URL playback error, so a genuine
  // (non-token) failure doesn't loop. Reset when playback moves to a different track.
  const recoveringRef        = useRef<string | null>(null);
  // Set when a remote stream errors out (e.g. the server briefly 502s during a restart, or a
  // socket the OS dropped while backgrounded) and recovery couldn't resume — usually because the
  // JS thread is throttled / offline in the background. Drives a resume on return to the
  // foreground, and is cleared once playback is genuinely running again.
  const pendingResumeRef     = useRef(false);
  // Bounded backoff retry for a stream that errored while foregrounded (transient server 5xx /
  // network blip). retryTimerRef holds the pending attempt; retryCountRef counts attempts for the
  // current errored track. Both reset when playback succeeds or moves to a different track.
  const retryTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef        = useRef(0);
  // Pending stream-load timing: armed when a remote track becomes active, cleared (and recorded)
  // when it first reaches a playable state — i.e. how long the user waited for audio to buffer.
  const streamLoadRef        = useRef<{ path: string; startedAt: number } | null>(null);
  // Timestamps of recent mid-track buffer starvations, newest last. The basis for deciding the
  // link genuinely cannot carry a full-quality stream.
  const stallsRef            = useRef<number[]>([]);
  const shuffleRef           = useRef(shuffle);
  const shuffleOrderRef      = useRef(shuffleOrder);
  const queueRef             = useRef(queue);
  const queueIndexRef        = useRef(queueIndex);

  useEffect(() => { shuffleRef.current      = shuffle; },      [shuffle]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { queueRef.current        = queue; },        [queue]);
  useEffect(() => { queueIndexRef.current   = queueIndex; },   [queueIndex]);

  // ── RNTP setup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    ensurePlayerSetup();
  }, []);

  // Local Loved/History state lives on-device (see localLibraryActivityStore) and isn't pushed
  // by any hub — load it once at startup so it's ready before the first local track plays, rather
  // than lazily on first visit to the Loved/History tabs.
  useEffect(() => {
    useLocalLibraryActivityStore.getState().load();
  }, []);

  // Rehydrate the React queue from RNTP after a JS-context reload. When Android tears down
  // the JS runtime in the background, the RNTP foreground service keeps the native queue and
  // active track alive — but this provider remounts with queue: []. useActiveTrack() then shows
  // the track while next/prev sit disabled and the queue panel is empty ("the queue is gone").
  // getQueue() returns each track's originalItem bundle, which preserves our _source field, so
  // we can reconstruct the MusicTrack[] and restore index from the native player.
  useEffect(() => {
    let cancelled = false;
    ensurePlayerSetup().then(async () => {
      if (cancelled || queueRef.current.length > 0) return; // React state already holds the queue
      try {
        const rntpQueue = await TrackPlayer.getQueue();
        if (cancelled || rntpQueue.length === 0) return;
        const tracks = rntpQueue
          .map(fromRntpTrack)
          .filter((t): t is MusicTrack => t != null);
        if (tracks.length === 0) return;
        const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
        if (cancelled) return;
        setQueue(tracks);
        setQueueIndex(idx);
        // The native queue's baked URLs carry pre-reload signatures and our signature cache is
        // empty after the reload. Warm it so artwork resolves; the next play/skip re-signs and
        // rebuilds the native queue (ensureFreshStreamUrls) so its URLs are guaranteed fresh.
        ensureSigned(tracks.map((t) => t.path)).catch(() => { /* re-signs lazily on play */ });
        remoteLog('info', `[player] rehydrated ${tracks.length}-track queue from RNTP after JS reload`);
      } catch (err: unknown) {
        remoteLog('warn', `[player] queue rehydrate failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // ── RNTP state hooks ───────────────────────────────────────────────────────

  const activeRntpTrack                            = useActiveTrack();
  const { playing = false, bufferingDuringPlay = false } = useIsPlaying();
  const { position, duration }                     = useProgress(250);

  // The first time playback actually starts, ask the user (once ever) to exempt the app from
  // battery optimization — otherwise Doze stalls background playback shortly after the screen locks.
  const batteryPromptedRef = useRef(false);
  useEffect(() => {
    if (!playing || batteryPromptedRef.current) return;
    batteryPromptedRef.current = true;
    promptBatteryExemptionOnce();
  }, [playing]);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      // Audio is flowing again — clear any recovery state so the next genuine error starts fresh.
      pendingResumeRef.current = false;
      retryCountRef.current = 0;
      recoveringRef.current = null;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    }
  }, [playing]);
  useEffect(() => { positionRef.current = position; }, [position]);

  const currentTrack = useMemo(() => fromRntpTrack(activeRntpTrack), [activeRntpTrack]);

  // Mirror "is a track loaded?" into the UI store so playback-start handlers can decide whether
  // to auto-expand the full player (only when nothing was playing — a genuinely fresh start).
  useEffect(() => { usePlayerUI.getState().setHasTrack(currentTrack != null); }, [currentTrack]);

  // Track active index and recover from stale-URL playback errors
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged, Event.PlaybackError], (event) => {
    if (event.type === Event.PlaybackError) {
      // Account a failed stream load if one was in flight, then clear the timer.
      if (streamLoadRef.current) {
        recordMediaLoad('stream', streamLoadRef.current.path, streamLoadRef.current.startedAt, false, {
          error: 'message' in event ? String(event.message) : 'playback error',
        });
        streamLoadRef.current = null;
      }
      const failed = queueRef.current[queueIndexRef.current];
      remoteLog('error', `[player] playback error — ${'message' in event ? String(event.message) : JSON.stringify(event)} [quality=${currentStreamQuality()}, track=${failed?.path ?? 'none'}]`);
      // A remote stream can fail two ways: an expired signature baked into its URL (401), or a
      // transient server/network blip (e.g. the backend 502ing during a restart). Both recover on
      // their own if we retry — re-sign (cheap, fixes the 401 case) and re-prepare the player
      // (TrackPlayer.retry() reloads the errored item; play() alone won't). Back off exponentially
      // and cap the attempts so a genuinely broken track (missing file) doesn't loop forever.
      const active = queueRef.current[queueIndexRef.current];
      if (active && !isLocalPath(active.path)) {
        // The stream may not come back until we're foregrounded (background socket dropped, JS
        // timers throttled). Remember to resume on return; the AppState handler retries from there.
        pendingResumeRef.current = true;
        if (recoveringRef.current !== active.path) {
          recoveringRef.current = active.path; // new errored track — restart the retry budget
          retryCountRef.current = 0;
        }
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        if (retryCountRef.current < STREAM_RETRY_MAX) {
          const attempt = retryCountRef.current++;
          const delay = streamRetryDelayMs(attempt);
          remoteLog('info', `[player] stream error — retry ${attempt + 1}/${STREAM_RETRY_MAX} in ${delay}ms`);
          invalidateSignatures([active.path]); // force a re-sign even if the cached sig looks current
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            ensureFreshStreamUrls()
              .then(() => TrackPlayer.retry())
              .then(() => TrackPlayer.play())
              .catch((err: unknown) => remoteLog('warn', `[player] retry failed — ${err instanceof Error ? err.message : String(err)}`));
          }, delay);
        } else {
          remoteLog('warn', `[player] giving up after ${STREAM_RETRY_MAX} stream retries — ${active.path}`);
        }
      }
      return;
    }
    if ('index' in event && event.index != null) {
      // useProgress resets on this event too, but its previous track may still have an in-flight
      // poll. Reset the imperative copy immediately so a play/signature refresh during the
      // transition can never rebuild the new item at the old item's position.
      if (event.index !== queueIndexRef.current) positionRef.current = 0;
      queueIndexRef.current = event.index;
      setQueueIndex(event.index);
      // Reset the recovery state only when playback genuinely moves to a different track — our
      // own recovery rebuild re-fires this event for the same track, which must not re-arm it.
      const newPath = queueRef.current[event.index]?.path ?? null;
      if (newPath && newPath !== recoveringRef.current) {
        recoveringRef.current = null;
        retryCountRef.current = 0;
        if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      }
      // Arm stream-load timing for remote tracks; the PlaybackState listener stops it on the
      // first playable state. Local files load from disk instantly, so skip them.
      streamLoadRef.current = newPath && !isLocalPath(newPath)
        ? { path: newPath, startedAt: Date.now() }
        : null;
    }
  });

  // Stop the stream-load timer when buffering completes, recording how long the user waited for
  // audio to become playable. Only the first playable state after a track change counts — mid-play
  // buffering dips leave streamLoadRef null and are handled as stalls below.
  useTrackPlayerEvents([Event.PlaybackState], (event) => {
    const pending = streamLoadRef.current;
    if (!pending) return;
    if (event.state === State.Ready || event.state === State.Playing) {
      recordMediaLoad('stream', pending.path, pending.startedAt, true);
      streamLoadRef.current = null;
    }
  });

  // Whether the link can carry the stream is answered by one thing only: did the buffer run dry
  // while the user was listening. A dip with streamLoadRef still set is the initial load, not a
  // stall, so it does not count here.
  //
  // One stall is not a verdict — a passing blip, a roaming handover or a single slow read on the
  // server can empty the buffer once on a link that is otherwise fine. Downgrading on that would
  // cost quality for nothing, so it takes STALL_LIMIT within STALL_WINDOW_MS to conclude the pipe
  // is really too thin, and a clean spell to conclude it is not any more.
  useTrackPlayerEvents([Event.PlaybackState], (event) => {
    if (event.state !== State.Buffering) return;
    if (streamLoadRef.current) return;   // still the initial load of a new track
    if (!playingRef.current) return;     // paused/seeking — nothing was starved
    if (isLocalPath(queueRef.current[queueIndexRef.current]?.path ?? '')) return; // local file, not the network

    const now = Date.now();
    const recent = [...stallsRef.current.filter((t) => now - t < STALL_WINDOW_MS), now];
    stallsRef.current = recent;

    if (recent.length >= STALL_LIMIT && !useConnectionStore.getState().streamStruggling) {
      remoteLog('warn', `[conn] ${recent.length} stalls in ${Math.round(STALL_WINDOW_MS / 1000)}s — link is not keeping up`);
      useConnectionStore.getState()._setStreamStruggling(true);
    }
  });

  // Clear the flag once playback has been clean for a while, so a bad patch does not leave the
  // session reported as struggling for ever. Checked on a timer rather than on a stall, because
  // the evidence for recovery is the absence of events.
  useEffect(() => {
    const id = setInterval(() => {
      const { streamStruggling, _setStreamStruggling } = useConnectionStore.getState();
      if (!streamStruggling) return;
      const last = stallsRef.current[stallsRef.current.length - 1] ?? 0;
      if (Date.now() - last < STALL_RECOVERY_MS) return;
      stallsRef.current = [];
      remoteLog("info", `[conn] ${Math.round(STALL_RECOVERY_MS / 1000)}s without a stall — link healthy again`);
      _setStreamStruggling(false);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  // ── Side effects ───────────────────────────────────────────────────────────

  const recordPlay = useLibraryActivityStore((s) => s.recordPlay);
  const recordLocalPlay = useLocalLibraryActivityStore((s) => s.recordPlay);
  useEffect(() => {
    if (!currentTrack?.path) return;
    // Local files mean nothing to the server (it has no concept of a phone-only path), so their
    // plays are tracked entirely on-device instead of round-tripping to /musiclibrary/plays.
    if (isLocalPath(currentTrack.path)) {
      recordLocalPlay(currentTrack.path, {
        title: currentTrack.title, artist: currentTrack.artist, folder: currentTrack.directory,
      });
    } else {
      recordPlay(currentTrack.path);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.path]);

  const networkSwitchedAt = useConnectionStore((s) => s.networkSwitchedAt);
  useEffect(() => {
    if (!networkSwitchedAt) return;
    if (!playingRef.current) return; // idle — the foreground/play path re-signs and rebuilds

    // ExoPlayer keeps playing from its buffer (≥30 s) across a wifi↔cellular handover,
    // so the switch is normally seamless. Only force a reconnecting seek if playback has
    // actually stalled — an unconditional seek throws the buffer away and causes an
    // audible stop/start on every network switch.
    const before = positionRef.current;
    const timer = setTimeout(() => {
      if (!playingRef.current) return;
      const advanced = positionRef.current - before;
      if (advanced < 0.5) {
        remoteLog('info', `[player] playback stalled after network switch (advanced ${advanced.toFixed(2)}s) — reconnecting`);
        TrackPlayer.seekTo(positionRef.current);
      }
    }, 4_000);
    return () => clearTimeout(timer);
   
  }, [networkSwitchedAt]);

  const storeAccessToken = useAuthStore((s) => s.accessToken);

  // Ensure the queue's server tracks have fresh path signatures, and — if any signature actually
  // changed — rebuild the RNTP queue in place (preserving index + position) so its baked URLs
  // carry the new signature. Stream/artwork URLs bake the signature at queue-build time; an
  // expired signature returns 401 and RNTP stops silently after ~1 s of buffering. Resolves once
  // the queue is safe to play, so callers can await it immediately before TrackPlayer.play().
  const ensureFreshStreamUrls = useCallback(async () => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const remotePaths = q.map((t) => t.path).filter((p) => !isLocalPath(p));
    if (remotePaths.length === 0) return; // all-local — file URLs never expire

    const before = remotePaths.map((p) => getSignature(p)?.sig ?? '').join('|');
    await ensureSigned(remotePaths);
    const after = remotePaths.map((p) => getSignature(p)?.sig ?? '').join('|');
    if (after === before) return; // signatures unchanged — baked URLs still valid

    const idx = queueIndexRef.current;
    const pos = positionRef.current;
    remoteLog('info', '[player] stream signatures refreshed — rebuilding queue');
    try {
      await TrackPlayer.setQueue(q.map(toRntpTrack));
      // Restore index + position via skip's initialPosition. A bare seekTo() right after
      // setQueue races the queue's native re-prepare and is dropped (resuming from 0);
      // skip applies the seek as part of the load, after prepare, so it sticks.
      await TrackPlayer.skip(idx, pos);
    } catch (err: unknown) {
      remoteLog('warn', `[player] queue rebuild failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // While the app is backgrounded, JS timers are paused so nothing refreshes the access
  // token. After a long background the token baked into the loaded track's stream URL can
  // be expired — pressing play would replay a stale URL and get a silent 401. On return to
  // the foreground, proactively refresh the (idle) token and rebuild the queue with fresh
  // URLs so the next play resumes cleanly.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (playingRef.current) return;        // stream alive — don't disturb it
      if (queueRef.current.length === 0) return;

      // Playback died while backgrounded (the OS dropped the socket, or the server blipped) and
      // couldn't recover offline / with JS timers throttled. Now that we're foregrounded and online
      // again, re-sign, re-prepare and resume so the user doesn't return to silently-stopped audio
      // with no controls. Reset the retry budget so this gets a fresh batch of attempts.
      if (pendingResumeRef.current) {
        recoveringRef.current = null;
        retryCountRef.current = 0;
        if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
        remoteLog('info', '[player] resuming playback that stopped while backgrounded');
        ensureFreshStreamUrls()
          .then(() => TrackPlayer.retry())
          .then(() => TrackPlayer.play())
          .catch((err: unknown) => remoteLog('warn', `[player] background-resume failed — ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      ensureFreshStreamUrls().catch(() => { /* refresh failure surfaces via interceptor/login */ });
    });
    return () => sub.remove();
  }, [ensureFreshStreamUrls]);

  // Cancel any pending stream-retry timer on unmount so it can't fire against a torn-down player.
  useEffect(() => () => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  // Prefetch artwork for the couple of tracks on either side of the current one, so skipping
  // forward/back shows the cover instantly instead of fetching it on demand. Warms expo-image's
  // cache under the same stable cacheKey the player renders with (path-derived, survives URL
  // signature rotation). Server tracks are signed first so their artwork URL is valid; the work
  // is best-effort and runs off the playback critical path.
  useEffect(() => {
    if (queue.length === 0) return;
    let cancelled = false;

    (async () => {
      const neighbours: MusicTrack[] = [];
      for (let d = -PREFETCH_RADIUS; d <= PREFETCH_RADIUS; d++) {
        const t = d !== 0 ? queue[queueIndex + d] : undefined;
        if (t?.hasArtwork) neighbours.push(t);
      }
      if (neighbours.length === 0) return;

      const serverPaths = neighbours.filter((t) => !isLocalPath(t.path)).map((t) => t.path);
      if (serverPaths.length > 0) {
        try { await ensureSigned(serverPaths); } catch { return; }
      }
      if (cancelled) return;

      await Promise.all(neighbours.map((t) => {
        const local = isLocalPath(t.path);
        const uri   = local ? t.coverPath : getArtworkUrl(t.path, PLAYER_ART_SIZE);
        if (!uri) return Promise.resolve();
        const cacheKey = local ? undefined : getArtworkCacheKey(t.path, PLAYER_ART_SIZE);
        return prefetchArtwork(uri, cacheKey);
      }));
    })();

    return () => { cancelled = true; };
  }, [queue, queueIndex]);

  // Pull the opening bytes of the track we would skip to next, while the current one plays.
  //
  // Starting a track is dominated by the server's first read, not by the transfer: the file has
  // to be found and its head fetched off disk before a single byte reaches us, and on a library
  // that lives on spinning disks that seek is most of the wait. Asking for the first few hundred
  // KB early puts the head of the file in the server's page cache, so the real request a moment
  // later is answered from memory. It costs one small range request per track change and takes
  // the seek off the critical path, where the listener is the one waiting for it.
  //
  // Best-effort throughout: any failure is silently irrelevant, because the normal load path is
  // unchanged and simply pays the usual cost. Skipped on cellular -- there, bytes cost money and
  // a prefetch that goes unused is waste, which is a different trade from a seek on a home LAN.
  useEffect(() => {
    if (queue.length === 0) return;
    if (useConnectionStore.getState().isCellular) return;

    // Where Next would actually land, so shuffle prefetches the right track rather than the
    // one that merely sits next in the list.
    const nextIdx = shuffleRef.current && shuffleOrderRef.current.length > 1
      ? shuffleOrderRef.current[(shuffleOrderRef.current.indexOf(queueIndex) + 1) % shuffleOrderRef.current.length]
      : queueIndex + 1;

    const nextTrack = queue[nextIdx];
    if (!nextTrack || isLocalPath(nextTrack.path)) return; // local files have no seek to hide

    const controller = new AbortController();
    const timer = setTimeout(() => {
      (async () => {
        try {
          if (!isSigned(nextTrack.path)) await ensureSigned([nextTrack.path]);
          await fetch(getStreamUrl(nextTrack.path), {
            headers: { Range: `bytes=0-${STREAM_PREFETCH_BYTES - 1}` },
            signal:  controller.signal,
          });
        } catch { /* best-effort: the normal load path is unaffected */ }
      })();
    }, STREAM_PREFETCH_DELAY_MS);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [queue, queueIndex]);

  // ── Playback commands ──────────────────────────────────────────────────────

  // Number of tracks (from the start) signed up-front before playback begins. The rest are
  // signed in the background so a large queue doesn't delay the first track.
  const HEAD_SIGN_COUNT = 2;

  const playQueue = useCallback(async (allTracks: MusicTrack[], startIndex = 0) => {
    const [tracks, idx] = windowQueue(allTracks, startIndex);

    // Sign the tapped track (plus a small look-ahead) BEFORE publishing it to the UI. The player
    // builds its artwork URL the instant the track appears, so signing afterwards raced it: the
    // cover went out unsigned, 401'd, and the panel stayed black for the whole song. Only the head
    // is signed here — the rest of the queue is handled below so a long queue can't delay playback.
    // Usually a no-op: list rows arrive with their signatures already seeded.
    await ensureSigned(tracks.slice(idx, idx + HEAD_SIGN_COUNT).map((t) => t.path));

    setQueue(tracks);
    setQueueIndex(idx);
    if (shuffleRef.current) setShuffleOrder(buildShuffleOrder(tracks.length, idx));
    await TrackPlayer.setQueue(tracks.map(toRntpTrack));
    if (idx > 0) await TrackPlayer.skip(idx);
    if (!suppressLocalPlayRef.current) await TrackPlayer.play();

    // Background: sign the remaining tracks, then re-bake the not-yet-played tail in place — the
    // currently playing track is left untouched, so there's no re-buffer, and auto-advance lands
    // on signed URLs instead of 401-ing into the stale-URL recovery path.
    // Only re-bake the tail if something in it is actually unsigned. Library rows now arrive with
    // their signatures embedded (seedSignatures), so this is usually false — and skipping it
    // avoids removing and re-adding hundreds of native queue items while the first track is still
    // being prepared, which is what made a shuffle of a big folder slow to start.
    const tailNeedsSigning = tracks
      .slice(idx + 1)
      .some((t) => !isLocalPath(t.path) && !isSigned(t.path));
    if (tailNeedsSigning) {
      void (async () => {
        await ensureSigned(tracks.map((t) => t.path));
        if (queueRef.current !== tracks) return; // a newer queue operation has taken over
        try {
          const activeIdx = (await TrackPlayer.getActiveTrackIndex()) ?? idx;
          const tailStart = activeIdx + 1;
          if (tailStart >= tracks.length) return;
          const indices = Array.from({ length: tracks.length - tailStart }, (_, i) => tailStart + i);
          await TrackPlayer.remove(indices);
          await TrackPlayer.add(tracks.slice(tailStart).map(toRntpTrack));
        } catch (err: unknown) {
          remoteLog('warn', `[player] tail re-sign failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    }
  }, []);

  // ── Android Auto ────────────────────────────────────────────────────────────
  // Route car-initiated playback through the app player so its queue/now-playing
  // stay in sync, and (re)build the car browse tree whenever auth changes.
  useEffect(() => {
    registerAutoPlayHandler((tracks, startIndex) => { playQueue(tracks, startIndex); });
    return () => registerAutoPlayHandler(null);
  }, [playQueue]);

  useEffect(() => {
    // The browse tree is served from the same native service/session that setupPlayer binds, so
    // pushing it before that bind completes throws "player not initialized" (RNTP rejects
    // setBrowseTree until its service connection is up). ensurePlayerSetup() is memoised, so this
    // just awaits whichever caller (UI or the headless service) started it first.
    ensurePlayerSetup()
      .then(() => (storeAccessToken ? buildAndroidAutoTree() : clearAndroidAutoTree()))
      .catch(() => { /* player unavailable; androidAuto's push() logs specifics */ });
  }, [storeAccessToken]);

  const lovedPaths = useLibraryActivityStore((s) => s.lovedPaths);
  const localLovedPaths = useLocalLibraryActivityStore((s) => s.lovedPaths);
  useEffect(() => {
    const isLoved = currentTrack
      ? (isLocalPath(currentTrack.path) ? localLovedPaths : lovedPaths).has(currentTrack.path)
      : false;
    // Wait for setup — this effect fires on mount, racing the async player init.
    ensurePlayerSetup()
      // Pass the FULL options (not just likeOptions) — updateOptions is a full replace, so a
      // partial call would wipe the transport capabilities and blank the lock-screen/shade controls.
      .then(() => TrackPlayer.updateOptions(buildPlayerOptions(isLoved)))
      .catch(() => { /* player unavailable */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.path, lovedPaths, localLovedPaths]);

  const playTrack = useCallback((track: MusicTrack) => {
    playQueue([track], 0);
  }, [playQueue]);

  const addToQueue = useCallback(async (incoming: MusicTrack[]) => {
    const tracks = incoming.slice(0, MAX_QUEUE - queueRef.current.length);
    if (!tracks.length) return;
    setQueue((prev) => [...prev, ...tracks]);
    await ensureSigned(tracks.map((t) => t.path));
    await TrackPlayer.add(tracks.map(toRntpTrack));
  }, []);

  const clearQueue = useCallback(async () => {
    const idx = queueIndexRef.current;
    const current = queueRef.current[idx];
    if (current) {
      setQueue([current]);
      setQueueIndex(0);
      await TrackPlayer.setQueue([toRntpTrack(current)]);
    }
    setShuffleOrder([]);
  }, []);

  // Full stop: empties the queue and tears the media service (and its notification) down.
  // Since appKilledPlaybackBehavior is ContinuePlayback, the player deliberately outlives the
  // app — and the shade offers no way out, because media3 renders only prev/play/next and marks
  // the notification NO_CLEAR. This is that missing exit.
  const stopPlayer = useCallback(async () => {
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    await TrackPlayer.reset();
  }, []);

  const playNext = useCallback(async (incoming: MusicTrack[]) => {
    const idx = queueIndexRef.current;
    const tracks = incoming.slice(0, MAX_QUEUE - queueRef.current.length);
    if (!tracks.length) return;
    setQueue((prev) => [...prev.slice(0, idx + 1), ...tracks, ...prev.slice(idx + 1)]);
    await ensureSigned(tracks.map((t) => t.path));
    await TrackPlayer.add(tracks.map(toRntpTrack), idx + 1);
  }, []);

  const skipToIndex = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= queueRef.current.length) return;
    // Skipping reuses the target track's baked stream URL, whose signature may have expired
    // (long idle, or a rehydrated post-reload queue) — refresh first so it doesn't 401.
    await ensureFreshStreamUrls();
    await TrackPlayer.skip(idx);
    await TrackPlayer.play();
  }, [ensureFreshStreamUrls]);

  const pause = useCallback(async () => {
    await TrackPlayer.pause();
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (playing) { await TrackPlayer.pause(); return; }
    // Resuming an already-loaded track reuses its baked stream URL, whose signature may have
    // expired while idle — refresh it first so play doesn't silently 401.
    await ensureFreshStreamUrls();
    await TrackPlayer.play();
  }, [playing, ensureFreshStreamUrls]);

  const next = useCallback(async () => {
    const q = queueRef.current;
    // Cold reopen: the React queue hasn't rehydrated yet but the native queue is alive — skip natively.
    if (q.length === 0) { await TrackPlayer.skipToNext().catch(() => { /* no next track */ }); return; }
    if (q.length <= 1) return;
    await ensureFreshStreamUrls();
    if (shuffleRef.current && shuffleOrderRef.current.length > 1) {
      const idx = queueIndexRef.current;
      const pos = shuffleOrderRef.current.indexOf(idx);
      const nextIdx = shuffleOrderRef.current[(pos + 1) % shuffleOrderRef.current.length];
      await TrackPlayer.skip(nextIdx);
    } else {
      await TrackPlayer.skipToNext();
    }
  }, [ensureFreshStreamUrls]);

  const prev = useCallback(async () => {
    if (positionRef.current > 3) { await TrackPlayer.seekTo(0); return; }
    const q = queueRef.current;
    // Cold reopen: defer to the native queue while the React queue is still rehydrating.
    if (q.length === 0) { await TrackPlayer.skipToPrevious().catch(() => { /* no previous track */ }); return; }
    if (q.length <= 1) { await TrackPlayer.seekTo(0); return; }
    await ensureFreshStreamUrls();
    if (shuffleRef.current && shuffleOrderRef.current.length > 1) {
      const idx = queueIndexRef.current;
      const pos = shuffleOrderRef.current.indexOf(idx);
      const len = shuffleOrderRef.current.length;
      await TrackPlayer.skip(shuffleOrderRef.current[(pos - 1 + len) % len]);
    } else {
      await TrackPlayer.skipToPrevious();
    }
  }, [ensureFreshStreamUrls]);

  const seekTo = useCallback((seconds: number) => {
    // A track can keep playing buffered audio after its signed URL expires, then fail as soon as
    // a seek asks the server for a new byte range. Refresh/rebuild first so that range request is
    // authenticated. Keep the ref in step immediately so a rebuild restores at the target rather
    // than briefly returning to the pre-seek position.
    const target = Math.max(0, seconds);
    const seekingPath = queueRef.current[queueIndexRef.current]?.path;
    positionRef.current = target;
    void (async () => {
      try {
        await ensureFreshStreamUrls();
        // A skip made while signatures were refreshing owns the player now; never apply this
        // track's seek target to the newly-active item.
        if (queueRef.current[queueIndexRef.current]?.path !== seekingPath) return;
        await TrackPlayer.seekTo(target);
      } catch (err: unknown) {
        remoteLog('warn', `[player] seek to ${target.toFixed(2)}s failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [ensureFreshStreamUrls]);

  const restoreTrack = useCallback(async (restoredTrack: MusicTrack) => {
    setQueue([restoredTrack]);
    setQueueIndex(0);
    await ensureSigned([restoredTrack.path]);
    await TrackPlayer.setQueue([toRntpTrack(restoredTrack)]);
    // Do not play — local playback is suppressed while casting
  }, []);

  const setSuppressLocalPlay = useCallback((suppress: boolean) => {
    suppressLocalPlayRef.current = suppress;
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((current) => {
      const next = !current;
      if (next) setShuffleOrder(buildShuffleOrder(queueRef.current.length, queueIndexRef.current));
      else      setShuffleOrder([]);
      return next;
    });
  }, []);

  // Cycle off → repeat-all → repeat-one → off, mirroring the setting into RNTP's native player.
  const cycleRepeat = useCallback(() => {
    setRepeatMode((current) => {
      const next: RepeatSetting = current === 'off' ? 'queue' : current === 'queue' ? 'track' : 'off';
      const rntpMode = next === 'queue' ? RepeatMode.Queue : next === 'track' ? RepeatMode.Track : RepeatMode.Off;
      ensurePlayerSetup()
        .then(() => TrackPlayer.setRepeatMode(rntpMode))
        .catch(() => { /* player unavailable */ });
      return next;
    });
  }, []);

  // ── Context values ─────────────────────────────────────────────────────────

  const playerValue = useMemo<PlayerContextValue>(() => ({
    track: currentTrack, queue, queueIndex, shuffle, repeatMode, cycleRepeat,
    playTrack, playQueue, addToQueue, clearQueue, stopPlayer, playNext, skipToIndex,
    pause, togglePlayPause, next, prev, seekTo, toggleShuffle,
    setSuppressLocalPlay, restoreTrack,
  }), [
    currentTrack, queue, queueIndex, shuffle, repeatMode, cycleRepeat,
    playTrack, playQueue, addToQueue, clearQueue, stopPlayer, playNext, skipToIndex,
    pause, togglePlayPause, next, prev, seekTo, toggleShuffle,
    setSuppressLocalPlay, restoreTrack,
  ]);

  const statusValue = useMemo<PlaybackStatusContextValue>(() => ({
    isPlaying:   playing,
    isBuffering: bufferingDuringPlay,
    durationSec: duration,
  }), [playing, bufferingDuringPlay, duration]);

  const positionValue = useMemo<PlaybackPositionContextValue>(() => ({
    positionSec: position,
    durationSec: duration,
  }), [position, duration]);

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlaybackStatusContext.Provider value={statusValue}>
        <PlaybackPositionContext.Provider value={positionValue}>
          {children}
        </PlaybackPositionContext.Provider>
      </PlaybackStatusContext.Provider>
    </PlayerContext.Provider>
  );
}

export const usePlayer = (): PlayerContextValue => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
};

export const usePlaybackStatus = (): PlaybackStatusContextValue =>
  useContext(PlaybackStatusContext);

export const usePlaybackPosition = (): PlaybackPositionContextValue =>
  useContext(PlaybackPositionContext);
