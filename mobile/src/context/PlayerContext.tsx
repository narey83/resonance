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
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  Track,
  useActiveTrack,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import { AppState } from 'react-native';
import { MusicTrack, getArtworkUrl, getStreamUrl, getTrackTitle } from '../api/musicLibrary';
import { isLocalPath } from '../services/localMusicLibrary';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { useConnectionStore } from '../services/connectionMonitor';
import { useAuthStore } from '../store/auth';
import { getValidToken } from '../api/client';
import { remoteLog } from '../api/remoteLogger';
import {
  buildAndroidAutoTree,
  clearAndroidAutoTree,
  registerAutoPlayHandler,
} from '../services/androidAuto';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlayerContextValue {
  track: MusicTrack | null;
  queue: MusicTrack[];
  queueIndex: number;
  shuffle: boolean;
  playTrack: (track: MusicTrack) => void;
  playQueue: (tracks: MusicTrack[], startIndex?: number) => void;
  addToQueue: (tracks: MusicTrack[]) => void;
  clearQueue: () => void;
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
  positionSec: number;
  durationSec: number;
}

const PlayerContext         = createContext<PlayerContextValue | null>(null);
const PlaybackStatusContext = createContext<PlaybackStatusContextValue>({
  isPlaying: false, isBuffering: false, positionSec: 0, durationSec: 0,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

type RntpTrack = Track & { _source: MusicTrack };

const toRntpTrack = (track: MusicTrack): RntpTrack => {
  const isLocal = isLocalPath(track.path);
  return {
    url:      isLocal ? track.path : getStreamUrl(track.path),
    title:    getTrackTitle(track),
    artist:   track.artist    ?? undefined,
    album:    track.album     ?? undefined,
    artwork:  track.hasArtwork ? (getArtworkUrl(track.path, 512) ?? undefined) : undefined,
    duration: track.duration  ?? undefined,
    _source:  track,
  } as RntpTrack;
};

const fromRntpTrack = (t: Track | undefined | null): MusicTrack | null =>
  t ? ((t as RntpTrack)._source ?? null) : null;

const buildShuffleOrder = (length: number, startIndex: number): number[] => {
  const indices = Array.from({ length }, (_, i) => i).filter((i) => i !== startIndex);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return [startIndex, ...indices];
};

// ── Provider ───────────────────────────────────────────────────────────────────

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // Local queue state — keeps MusicTrack objects without round-tripping through RNTP
  const [queue, setQueue]           = useState<MusicTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffle, setShuffle]       = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);

  const suppressLocalPlayRef = useRef(false);
  const positionRef          = useRef(0);
  const playingRef           = useRef(false);
  const shuffleRef           = useRef(shuffle);
  const shuffleOrderRef      = useRef(shuffleOrder);
  const queueRef             = useRef(queue);
  const queueIndexRef        = useRef(queueIndex);
  // Tracks which access token was in effect when the RNTP queue was last built,
  // so we know when stream URLs have gone stale.
  const queueTokenRef        = useRef<string | null>(null);

  useEffect(() => { shuffleRef.current      = shuffle; },      [shuffle]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { queueRef.current        = queue; },        [queue]);
  useEffect(() => { queueIndexRef.current   = queueIndex; },   [queueIndex]);

  // ── RNTP setup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const setup = async () => {
      try {
        await TrackPlayer.setupPlayer({
          maxCacheSize: 1024 * 256, // 256 MB on-disk cache — fewer re-downloads on repeat plays
          // Buffer generously so brief bandwidth dips (tunnels, weak cellular) don't stall:
          minBuffer:  30,  // keep ≥30 s buffered ahead
          maxBuffer:  120, // read up to 2 min ahead when bandwidth allows
          playBuffer: 5,   // wait for 5 s buffered before (re)starting playback
          backBuffer: 30,  // retain 30 s behind for instant back-seek
        });
      } catch {
        // Already set up
      }
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
        notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
      });
    };
    setup();
  }, []);

  // ── RNTP state hooks ───────────────────────────────────────────────────────

  const activeRntpTrack                            = useActiveTrack();
  const { playing = false, bufferingDuringPlay = false } = useIsPlaying();
  const { position, duration }                     = useProgress(250);

  useEffect(() => { playingRef.current  = playing; },  [playing]);
  useEffect(() => { positionRef.current = position; }, [position]);

  const currentTrack = useMemo(() => fromRntpTrack(activeRntpTrack), [activeRntpTrack]);

  // Track active index and log errors
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged, Event.PlaybackError], (event) => {
    if (event.type === Event.PlaybackError) {
      remoteLog('error', `[player] playback error — ${'message' in event ? String(event.message) : JSON.stringify(event)}`);
      return;
    }
    if ('index' in event && event.index != null) setQueueIndex(event.index);
  });

  // ── Side effects ───────────────────────────────────────────────────────────

  const recordPlay = useLibraryActivityStore((s) => s.recordPlay);
  useEffect(() => {
    if (currentTrack?.path) recordPlay(currentTrack.path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.path]);

  const networkSwitchedAt = useConnectionStore((s) => s.networkSwitchedAt);
  useEffect(() => {
    if (!networkSwitchedAt) return;
    if (!playingRef.current) return; // idle — the token-rotation effect rebuilds the queue

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkSwitchedAt]);

  // Whenever the access token rotates (proactive refresh or reconnect) and the player
  // is idle, rebuild the RNTP queue immediately with fresh stream URLs.
  // Stream URLs are baked with the token at queue-build time; a stale URL returns 401
  // and RNTP stops silently after ~1 s of buffering.
  const storeAccessToken = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    if (!storeAccessToken) return;                         // logged out
    if (storeAccessToken === queueTokenRef.current) return; // token unchanged
    if (playingRef.current) return;                        // stream alive — don't interrupt

    const q = queueRef.current;
    if (q.length === 0) {
      queueTokenRef.current = storeAccessToken;
      return;
    }

    const idx = queueIndexRef.current;
    const pos = positionRef.current;
    queueTokenRef.current = storeAccessToken;

    remoteLog('info', '[player] token rotated while idle — rebuilding queue with fresh URLs');
    TrackPlayer.setQueue(q.map(toRntpTrack))
      .then(() => idx > 0 ? TrackPlayer.skip(idx) : Promise.resolve())
      .then(() => TrackPlayer.seekTo(pos))
      .catch((err: unknown) => remoteLog('warn', `[player] queue rebuild failed — ${err instanceof Error ? err.message : String(err)}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeAccessToken]);

  // Refresh the access token if it's expiring, and — if it actually rotated — rebuild the
  // RNTP queue in place (preserving index + position) so its baked stream URLs carry the
  // fresh token. queueTokenRef is advanced *before* the rebuild so the token-rotation effect
  // above sees the token as already-applied and no-ops (no double rebuild). Resolves once the
  // queue is safe to play, so callers can await it immediately before TrackPlayer.play().
  const ensureFreshStreamUrls = useCallback(async () => {
    const fresh = await getValidToken();
    if (!fresh || fresh === queueTokenRef.current) return; // refresh failed, or URLs already current
    const q = queueRef.current;
    if (q.length === 0) { queueTokenRef.current = fresh; return; }

    const idx = queueIndexRef.current;
    const pos = positionRef.current;
    queueTokenRef.current = fresh;
    remoteLog('info', '[player] refreshing stale stream URLs before playback');
    try {
      await TrackPlayer.setQueue(q.map(toRntpTrack));
      if (idx > 0) await TrackPlayer.skip(idx);
      await TrackPlayer.seekTo(pos);
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
      ensureFreshStreamUrls().catch(() => { /* refresh failure surfaces via interceptor/login */ });
    });
    return () => sub.remove();
  }, [ensureFreshStreamUrls]);

  // ── Playback commands ──────────────────────────────────────────────────────

  const playQueue = useCallback(async (tracks: MusicTrack[], startIndex = 0) => {
    const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
    setQueue(tracks);
    setQueueIndex(idx);
    if (shuffleRef.current) setShuffleOrder(buildShuffleOrder(tracks.length, idx));
    queueTokenRef.current = useAuthStore.getState().accessToken;
    await TrackPlayer.setQueue(tracks.map(toRntpTrack));
    if (idx > 0) await TrackPlayer.skip(idx);
    if (!suppressLocalPlayRef.current) await TrackPlayer.play();
  }, []);

  // ── Android Auto ────────────────────────────────────────────────────────────
  // Route car-initiated playback through the app player so its queue/now-playing
  // stay in sync, and (re)build the car browse tree whenever auth changes.
  useEffect(() => {
    registerAutoPlayHandler((tracks, startIndex) => { playQueue(tracks, startIndex); });
    return () => registerAutoPlayHandler(null);
  }, [playQueue]);

  useEffect(() => {
    if (storeAccessToken) buildAndroidAutoTree();
    else clearAndroidAutoTree();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeAccessToken]);

  const playTrack = useCallback((track: MusicTrack) => {
    playQueue([track], 0);
  }, [playQueue]);

  const addToQueue = useCallback(async (tracks: MusicTrack[]) => {
    setQueue((prev) => [...prev, ...tracks]);
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

  const playNext = useCallback(async (tracks: MusicTrack[]) => {
    const idx = queueIndexRef.current;
    setQueue((prev) => [...prev.slice(0, idx + 1), ...tracks, ...prev.slice(idx + 1)]);
    await TrackPlayer.add(tracks.map(toRntpTrack), idx + 1);
  }, []);

  const skipToIndex = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= queueRef.current.length) return;
    await TrackPlayer.skip(idx);
    await TrackPlayer.play();
  }, []);

  const pause = useCallback(async () => {
    await TrackPlayer.pause();
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (playing) { await TrackPlayer.pause(); return; }
    // Resuming an already-loaded track reuses its baked stream URL, whose token may have
    // expired while idle — refresh it first so play doesn't silently 401.
    await ensureFreshStreamUrls();
    await TrackPlayer.play();
  }, [playing, ensureFreshStreamUrls]);

  const next = useCallback(async () => {
    const q = queueRef.current;
    if (q.length <= 1) return;
    if (shuffleRef.current && shuffleOrderRef.current.length > 1) {
      const idx = queueIndexRef.current;
      const pos = shuffleOrderRef.current.indexOf(idx);
      const nextIdx = shuffleOrderRef.current[(pos + 1) % shuffleOrderRef.current.length];
      await TrackPlayer.skip(nextIdx);
    } else {
      await TrackPlayer.skipToNext();
    }
  }, []);

  const prev = useCallback(async () => {
    if (positionRef.current > 3) { await TrackPlayer.seekTo(0); return; }
    const q = queueRef.current;
    if (q.length <= 1) { await TrackPlayer.seekTo(0); return; }
    if (shuffleRef.current && shuffleOrderRef.current.length > 1) {
      const idx = queueIndexRef.current;
      const pos = shuffleOrderRef.current.indexOf(idx);
      const len = shuffleOrderRef.current.length;
      await TrackPlayer.skip(shuffleOrderRef.current[(pos - 1 + len) % len]);
    } else {
      await TrackPlayer.skipToPrevious();
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    TrackPlayer.seekTo(seconds);
  }, []);

  const restoreTrack = useCallback(async (restoredTrack: MusicTrack) => {
    setQueue([restoredTrack]);
    setQueueIndex(0);
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

  // ── Context values ─────────────────────────────────────────────────────────

  const playerValue = useMemo<PlayerContextValue>(() => ({
    track: currentTrack, queue, queueIndex, shuffle,
    playTrack, playQueue, addToQueue, clearQueue, playNext, skipToIndex,
    pause, togglePlayPause, next, prev, seekTo, toggleShuffle,
    setSuppressLocalPlay, restoreTrack,
  }), [
    currentTrack, queue, queueIndex, shuffle,
    playTrack, playQueue, addToQueue, clearQueue, playNext, skipToIndex,
    pause, togglePlayPause, next, prev, seekTo, toggleShuffle,
    setSuppressLocalPlay, restoreTrack,
  ]);

  const statusValue = useMemo<PlaybackStatusContextValue>(() => ({
    isPlaying:   playing,
    isBuffering: bufferingDuringPlay,
    positionSec: position,
    durationSec: duration,
  }), [playing, bufferingDuringPlay, position, duration]);

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlaybackStatusContext.Provider value={statusValue}>
        {children}
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
