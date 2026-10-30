import {
  getAlbumPage,
  getArtistPage,
  getLibraryStats,
  getRecentlyAdded,
} from '../lib/musicLibrary';
import { useEffect, useState } from 'react';

export const HOME_RECENT_ALBUM_LIMIT = 16;

// The one-row artist/album responses still aggregate the entire library on a
// cache miss. Start those after the visible shelf, so they cannot delay it.
export default function useLibraryHomeData(
  revision,
  recentLimit = HOME_RECENT_ALBUM_LIMIT,
) {
  const [albumCount, setAlbumCount] = useState(0);
  const [artistCount, setArtistCount] = useState(0);
  const [libraryStats, setLibraryStats] = useState(null);
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const apply = async (promise, set) => {
      try {
        const result = await promise;
        if (!cancelled && result != null) set(result);
      } catch {
        // Keep the last successful data; one failure must not block other sections.
      }
    };

    const load = async () => {
      const stats = apply(getLibraryStats(), setLibraryStats);
      await apply(getRecentlyAdded(recentLimit), setRecentlyAdded);
      if (cancelled) return;
      await Promise.all([
        stats,
        apply(getArtistPage({ limit: 1 }), (page) =>
          setArtistCount(page.total),
        ),
        apply(getAlbumPage({ limit: 1 }), (page) => setAlbumCount(page.total)),
      ]);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [recentLimit, revision]);
  return { albumCount, artistCount, libraryStats, recentlyAdded };
}
