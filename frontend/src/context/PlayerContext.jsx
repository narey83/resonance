// <copyright file="PlayerContext.jsx" company="John Narey">
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

import { getTracks } from '../lib/musicLibrary';
import * as prefs from '../lib/prefs';
import { ensureSigned } from '../lib/streamSignatures';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const PlayerContext = createContext(null);

const SESSION_KEY = 'resonance-player-session';
const QUEUE_PANEL_KEY = 'resonance-queue-panel-open';

const loadSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveSession = (data) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // ignore — storage may be unavailable
  }
};

const clearSession = () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
};

// ponytail: hard queue cap. "Play All" over a 46k-track library used to stringify ~20MB into
// sessionStorage (5MB quota) every save and sign every path in one POST — the tab locked up.
// 500 tracks is ~33h of playback; raise it if that ever feels short.
const MAX_QUEUE = 500;
const LEAD_IN = 50; // kept before the tapped track so Previous still has somewhere to go

// Window a too-long track list around the tapped index. Returns [tracks, index].
const windowQueue = (tracks, startIndex) => {
  const start = Math.max(0, Math.min(startIndex, tracks.length - 1));
  if (tracks.length <= MAX_QUEUE) return [tracks, start];
  const from = Math.max(
    0,
    Math.min(start - LEAD_IN, tracks.length - MAX_QUEUE),
  );
  return [tracks.slice(from, from + MAX_QUEUE), start - from];
};

const buildShuffleOrder = (length, startIndex) => {
  const indices = Array.from({ length }, (_, position) => position).filter(
    (position) => position !== startIndex,
  );
  for (let index = indices.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }

  return [startIndex, ...indices];
};

export const PlayerProvider = ({ children }) => {
  const [queuePanelOpen, setQueuePanelOpen] = useState(
    () => prefs.get(QUEUE_PANEL_KEY, true) !== false,
  );

  const toggleQueuePanel = useCallback(() => {
    setQueuePanelOpen((prev) => {
      const opened = !prev;
      prefs.set(QUEUE_PANEL_KEY, opened);
      return opened;
    });
  }, []);

  const initialSession = useMemo(() => loadSession(), []);
  const [sessionValidated, setSessionValidated] = useState(
    !initialSession?.queue?.length,
  );
  const [track, setTrack] = useState(initialSession?.track ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [restoredFromSession, setRestoredFromSession] = useState(() =>
    Boolean(loadSession()?.track),
  );
  const [queue, setQueue] = useState(initialSession?.queue ?? []);
  const [queueIndex, setQueueIndex] = useState(initialSession?.queueIndex ?? 0);
  const [shuffle, setShuffle] = useState(initialSession?.shuffle ?? false);
  const [shuffleOrder, setShuffleOrder] = useState(
    initialSession?.shuffleOrder ?? [],
  );
  // Stable refs so that next/prev/toggleShuffle callbacks never go stale
  const saveTimeoutRef = useRef(null);
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const shuffleRef = useRef(shuffle);
  const shuffleOrderRef = useRef(shuffleOrder);
  const trackRef = useRef(track);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    shuffleOrderRef.current = shuffleOrder;
  }, [shuffleOrder]);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  // A click on a mini waveform wants to seek a track that may not be the one
  // loaded yet. MediaPlayer owns the actual <audio> element, so the two sides
  // meet through refs shared via context rather than lifting playback
  // mechanics up here: seekHandlerRef is MediaPlayer's "seek the track that's
  // already loaded and make sure it's playing", pendingSeekRef is the
  // position to jump to once a newly-switched-to track finishes loading.
  const seekHandlerRef = useRef(null);
  const pendingSeekRef = useRef(null);

  const registerSeekHandler = useCallback((fn) => {
    seekHandlerRef.current = fn;
  }, []);

  // On mount, validate session queue paths against music.db and drop stale entries.
  // PlayerProvider only mounts when authenticated so API calls are safe.
  useEffect(() => {
    const queueTracks = initialSession?.queue ?? [];
    if (!queueTracks.length) {
      setSessionValidated(true);
      return;
    }

    // Warm signatures for every restored track (not just one sample per folder,
    // below) — otherwise the restored current track may go unsigned and 401 on
    // first play after a refresh.
    ensureSigned(queueTracks.map((t) => t.path));

    const folderOf = (t) => {
      const p = t?.filename || t?.path || '';
      const slash = p.lastIndexOf('/');
      return slash > 0 ? p.slice(0, Math.max(0, slash)) : null;
    };

    const uniqueFolders = [
      ...new Set(queueTracks.map(folderOf).filter(Boolean)),
    ];

    Promise.all(
      uniqueFolders.map((folder) =>
        getTracks({ folder, limit: 1 })
          .then((result) => ({
            folder,
            exists: (result?.tracks?.length ?? 0) > 0,
          }))
          .catch(() => ({ folder, exists: true })),
      ),
    ).then((results) => {
      const dead = new Set(
        results.filter((r) => !r.exists).map((r) => r.folder),
      );
      if (dead.size > 0) {
        setQueue((prev) => prev.filter((t) => !dead.has(folderOf(t))));
        setTrack((prev) => (prev && dead.has(folderOf(prev)) ? null : prev));
      }

      setSessionValidated(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!track) {
      clearTimeout(saveTimeoutRef.current);
      clearSession();
      return undefined;
    }

    setQueuePanelOpen((prev) => {
      if (!prev) {
        prefs.set(QUEUE_PANEL_KEY, true);
        return true;
      }

      return prev;
    });
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveSession({ queue, queueIndex, shuffle, shuffleOrder, track });
    }, 300);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [queue, queueIndex, shuffle, shuffleOrder, track]);

  const play = useCallback((newTrack) => {
    setRestoredFromSession(false);
    setTrack(newTrack);
    setQueue([newTrack]);
    setQueueIndex(0);
    setShuffleOrder([0]);
  }, []);

  const playQueue = useCallback((allTracks, startIndex = 0) => {
    if (!allTracks?.length) return;
    const [tracks, index] = windowQueue(allTracks, startIndex);
    setRestoredFromSession(false);
    setQueue(tracks);
    setQueueIndex(index);
    setTrack(tracks[index]);
    if (shuffleRef.current) {
      const order = buildShuffleOrder(tracks.length, index);
      setShuffleOrder(order);
    } else {
      setShuffleOrder([]);
    }
  }, []);

  // Same track already loaded → seek it in place. Different track → queue it
  // like a normal click would, and leave the position for MediaPlayer to pick
  // up once that track's audio has actually loaded.
  const seekTrack = useCallback(
    (allTracks, index, time) => {
      const target = allTracks[index];
      if (!target) return;
      const identity = target.filename || target.path;
      const currentIdentity =
        trackRef.current?.filename || trackRef.current?.path;
      if (identity === currentIdentity && seekHandlerRef.current) {
        seekHandlerRef.current(time);
        return;
      }

      pendingSeekRef.current = { identity, time };
      playQueue(allTracks, index);
    },
    [playQueue],
  );

  const next = useCallback(() => {
    const currentQueue = queueRef.current;
    const currentIndex = queueIndexRef.current;
    const isShuffle = shuffleRef.current;
    const order = shuffleOrderRef.current;
    if (currentQueue.length <= 1) return;
    let nextIndex;
    if (isShuffle && order.length > 1) {
      const position = order.indexOf(currentIndex);
      nextIndex = order[(position + 1) % order.length];
    } else {
      nextIndex = (currentIndex + 1) % currentQueue.length;
    }

    setRestoredFromSession(false);
    setQueueIndex(nextIndex);
    setTrack(currentQueue[nextIndex]);
  }, []);

  const previous = useCallback(() => {
    const currentQueue = queueRef.current;
    const currentIndex = queueIndexRef.current;
    const isShuffle = shuffleRef.current;
    const order = shuffleOrderRef.current;
    if (currentQueue.length <= 1) return;
    let previousIndex;
    if (isShuffle && order.length > 1) {
      const position = order.indexOf(currentIndex);
      previousIndex = order[(position - 1 + order.length) % order.length];
    } else {
      previousIndex =
        (currentIndex - 1 + currentQueue.length) % currentQueue.length;
    }

    setRestoredFromSession(false);
    setQueueIndex(previousIndex);
    setTrack(currentQueue[previousIndex]);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((current) => {
      const newShuffle = !current;

      if (newShuffle) {
        const order = buildShuffleOrder(
          queueRef.current.length,
          queueIndexRef.current,
        );
        setShuffleOrder(order);
      } else {
        setShuffleOrder([]);
      }

      return newShuffle;
    });
  }, []);

  const stop = useCallback(() => {
    setTrack(null);
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    clearSession();
  }, []);

  const clearQueue = useCallback(() => {
    if (queueIndexRef.current !== null) {
      setQueue((current) => [current[queueIndexRef.current]]);
      setQueueIndex(0);
      setShuffleOrder([]);
    }
  }, []);

  const jumpTo = useCallback((index) => {
    const currentQueue = queueRef.current;
    if (index < 0 || index >= currentQueue.length) return;
    setRestoredFromSession(false);
    setQueueIndex(index);
    setTrack(currentQueue[index]);
  }, []);

  const enqueueTrack = useCallback((newTrack) => {
    setQueue((current) => [...current, newTrack]);
  }, []);

  const insertIntoQueue = useCallback((newTrack, index) => {
    const currentIndex = queueIndexRef.current;
    setQueue((current) => {
      const updated = [...current];
      updated.splice(index, 0, newTrack);
      return updated;
    });
    if (index <= currentIndex) {
      setQueueIndex(currentIndex + 1);
    }
  }, []);

  const addToQueueNext = useCallback((newTrack) => {
    setQueue((current) => {
      const idx = queueIndexRef.current;
      const updated = [...current];
      updated.splice(idx + 1, 0, newTrack);
      return updated;
    });
  }, []);

  const removeFromQueue = useCallback((index) => {
    const currentIndex = queueIndexRef.current;
    if (index === currentIndex) return;
    setQueue((current) => {
      const updated = [...current];
      updated.splice(index, 1);
      return updated;
    });
    if (index < currentIndex) {
      setQueueIndex(currentIndex - 1);
    }
  }, []);

  const reorderQueue = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    const currentIndex = queueIndexRef.current;
    setQueue((current) => {
      const updated = [...current];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
    let newIndex = currentIndex;
    if (fromIndex === currentIndex) {
      newIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      newIndex = currentIndex - 1;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      newIndex = currentIndex + 1;
    }

    if (newIndex !== currentIndex) {
      setQueueIndex(newIndex);
    }
  }, []);

  const value = useMemo(
    () => ({
      addToQueueNext,
      clearQueue,
      enqueueTrack,
      hasQueue: queue.length > 1,
      insertIntoQueue,
      isPlaying,
      jumpTo,
      next,
      pendingSeekRef,
      play,
      playQueue,
      prev: previous,
      queue: sessionValidated ? queue : [],
      queueIndex,
      queuePanelOpen,
      registerSeekHandler,
      removeFromQueue,
      reorderQueue,
      restoredFromSession: sessionValidated && restoredFromSession,
      seekTrack,
      setIsPlaying,
      shuffle,
      stop,
      toggleQueuePanel,
      toggleShuffle,
      track: sessionValidated ? track : null,
    }),
    [
      addToQueueNext,
      clearQueue,
      enqueueTrack,
      insertIntoQueue,
      isPlaying,
      jumpTo,
      next,
      play,
      playQueue,
      previous,
      queue,
      queueIndex,
      queuePanelOpen,
      registerSeekHandler,
      removeFromQueue,
      reorderQueue,
      restoredFromSession,
      seekTrack,
      sessionValidated,
      setIsPlaying,
      shuffle,
      stop,
      toggleQueuePanel,
      toggleShuffle,
      track,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = () => useContext(PlayerContext);
