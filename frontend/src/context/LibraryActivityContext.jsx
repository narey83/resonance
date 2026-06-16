import { createLibraryActivityHubConnection } from '../lib/hubFactory';
import {
  clearAllLoved as apiClearAllLoved,
  clearHistory as apiClearHistory,
  deletePlay as apiDeletePlay,
  loveTrack,
  recordPlay as apiRecordPlay,
  unloveTrack,
} from '../lib/libraryActivity';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const LibraryActivityContext = createContext(null);

export const LibraryActivityProvider = ({ children }) => {
  const [lovedPaths, setLovedPaths] = useState(() => new Set());
  const [playStats, setPlayStats] = useState(() => new Map());
  const [playHistory, setPlayHistory] = useState([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const hubRef = useRef(null);

  useEffect(() => {
    const hub = createLibraryActivityHubConnection();
    hubRef.current = hub;

    hub.on('SNAPSHOT', ({ lovedPaths: paths, playStats: stats }) => {
      setLovedPaths(new Set(paths));
      setPlayStats(new Map(stats.map((s) => [s.path, s])));
    });

    hub.on('TRACK_LOVED', (path) => {
      setLovedPaths((prev) => new Set([...prev, path]));
    });

    hub.on('TRACK_UNLOVED', (path) => {
      setLovedPaths((prev) => {
        const n = new Set(prev);
        n.delete(path);
        return n;
      });
    });

    hub.on('ALL_UNLOVED', () => {
      setLovedPaths(new Set());
    });

    hub.on('TRACK_PLAYED', ({ record, stat }) => {
      setPlayStats((prev) => new Map(prev).set(stat.path, stat));
      setPlayHistory((prev) => {
        if (prev.some((e) => e.id === record.id)) return prev;
        return [record, ...prev].slice(0, 500);
      });
    });

    hub.on('PLAY_DELETED', (id) => {
      setPlayHistory((prev) => prev.filter((e) => e.id !== id));
    });

    hub.on('HISTORY_CLEARED', () => {
      setPlayHistory([]);
    });

    hub.on('LIBRARY_UPDATED', () => {
      setLibraryRevision((r) => r + 1);
    });

    hub.start().catch(() => {});

    return () => {
      hub.stop();
    };
  }, []);

  const toggleLove = useCallback(
    async (path) => {
      const isLoved = lovedPaths.has(path);
      setLovedPaths((prev) => {
        const next = new Set(prev);
        if (isLoved) next.delete(path);
        else next.add(path);
        return next;
      });
      try {
        if (isLoved) await unloveTrack(path);
        else await loveTrack(path);
      } catch {
        setLovedPaths((prev) => {
          const next = new Set(prev);
          if (isLoved) next.add(path);
          else next.delete(path);
          return next;
        });
      }
    },
    [lovedPaths],
  );

  const clearAllLoved = useCallback(async () => {
    setLovedPaths(new Set());
    try {
      await apiClearAllLoved();
    } catch {
      /* hub will revert via snapshot on reconnect */
    }
  }, []);

  const recordPlay = useCallback(async (path) => {
    if (!path) return;
    try {
      await apiRecordPlay(path);
      // Hub broadcasts TRACK_PLAYED with { stat, record } — handler above updates both maps
    } catch {
      /* fire-and-forget */
    }
  }, []);

  const deletePlay = useCallback(async (id) => {
    setPlayHistory((prev) => prev.filter((e) => e.id !== id));
    try {
      await apiDeletePlay(id);
    } catch {
      /* hub will correct on reconnect */
    }
  }, []);

  const clearHistory = useCallback(async () => {
    setPlayHistory([]);
    try {
      await apiClearHistory();
    } catch {
      /* hub will correct on reconnect */
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      lovedPaths,
      playStats,
      playHistory,
      libraryRevision,
      toggleLove,
      clearAllLoved,
      recordPlay,
      deletePlay,
      clearHistory,
    }),
    [
      clearAllLoved,
      clearHistory,
      deletePlay,
      libraryRevision,
      lovedPaths,
      playHistory,
      playStats,
      recordPlay,
      toggleLove,
    ],
  );

  return (
    <LibraryActivityContext.Provider value={contextValue}>
      {children}
    </LibraryActivityContext.Provider>
  );
};

export const useLibraryActivity = () => useContext(LibraryActivityContext);
