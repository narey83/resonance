// <copyright file="usePagedList.js" company="John Narey">
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

import { useLibraryActivity } from '../context/LibraryActivityContext';
import useDebounce from '../hooks/useDebounce';
import { getTrackPage } from './musicLibrary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Fetches a list one window at a time instead of all of it. The library is ~48k tracks / ~19k
// album groups; pulling those whole cost 30MB and 12s before anything rendered, while the
// virtualised lists only ever show a screenful.
//
// `fetchPage` takes the query plus { limit, offset } and resolves to { items, total }, where
// total is the size of the whole matching set — that's what tells us when to stop asking.
// Changing `query` (compared by value, not identity) starts over from offset 0.
//
// ponytail: pages accumulate for as long as the query stands; nothing is evicted as you scroll
// past it. Scrolling 25k rows to reach ~15MB of retained objects is not a real session, and
// dropping them only buys a re-fetch when the user scrolls back up. Evict here if a profile
// ever says otherwise.
export const usePagedList = (
  fetchPage,
  query,
  { enabled = true, pageSize = 200, refreshToken = 0 } = {},
) => {
  const key = JSON.stringify(query ?? null);

  // Held in a ref so callers can pass an inline function without restarting the query.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);

  // Refs are the source of truth; state is the render mirror. loadMore fires from a scroll
  // handler and has to see what's already loaded without waiting for a re-render to land.
  const itemsRef = useRef([]);
  const totalRef = useRef(0);
  const busyRef = useRef(false);

  // Bumped on every query change. A response tagged with a stale generation is discarded, so a
  // slow first page can't overwrite results for a query the user has already moved past.
  const generationRef = useRef(0);

  // A page can land after the user has navigated away from the view entirely — the generation
  // check catches a changed query, but not an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const apply = useCallback((generation, page, append) => {
    if (!mountedRef.current || generation !== generationRef.current) return;
    itemsRef.current = append
      ? [...itemsRef.current, ...(page.items ?? [])]
      : page.items ?? [];
    totalRef.current = page.total ?? 0;
    setItems(itemsRef.current);
    setTotal(totalRef.current);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    itemsRef.current = [];
    totalRef.current = 0;
    setItems([]);
    setTotal(0);
    setLoadingMore(false);

    if (!enabled) {
      busyRef.current = false;
      setLoading(false);
      return undefined;
    }

    busyRef.current = true;
    setLoading(true);

    // Reopening the same view/query (e.g. navigating away and back) should land where the user
    // left off, not back at row 200 — request as many rows as were loaded last time instead of
    // just one page, so the scroll-restore code in Library.jsx has something to land on.
    let initialLimit = pageSize;
    try {
      const savedCount = sessionStorage.getItem(`resonance-paged-count:${key}`);
      if (savedCount)
        initialLimit = Math.max(pageSize, Number(savedCount) || 0);
    } catch {
      /* ignore */
    }

    (async () => {
      try {
        const page = await fetchRef.current({
          ...JSON.parse(key),
          limit: initialLimit,
          offset: 0,
        });
        apply(generation, page, false);
      } catch {
        // leave the list empty; changing the query or scrolling retries
      } finally {
        if (mountedRef.current && generation === generationRef.current) {
          busyRef.current = false;
          setLoading(false);
        }
      }
    })();

    return undefined;
  }, [apply, enabled, key, pageSize]);

  // Rows already on screen go stale when something rewrites them — an analysis writing BPM and
  // key into a track's tags, a rename, a rescan. Refetch exactly the window we already hold
  // instead of starting the query over: clearing items first would collapse the list back to
  // its first page and throw away the user's place in it.
  //
  // ponytail: refetches the whole loaded window on every library update, so a long scan that
  // broadcasts repeatedly re-reads the same rows each time. Debounce it if that ever shows up
  // in a profile — one query against a cached list is cheap next to losing your place.
  useEffect(() => {
    if (!enabled || refreshToken === 0) return undefined;

    let timer = null;
    let cancelled = false;

    const refresh = async () => {
      if (cancelled) return;

      // Waits for an in-flight fetch rather than giving up on the update. A scan broadcasts at
      // most once a second and its last broadcast — the one carrying the final track's key, BPM
      // and loudness — is as likely to land during a fetch as anywhere else; dropping that one
      // left the list stale until the view was remounted. Waiting also covers a broadcast that
      // arrives before the first page has landed, which has nothing to refresh yet.
      if (busyRef.current) {
        timer = setTimeout(refresh, 250);
        return;
      }

      const count = itemsRef.current.length;
      if (count === 0) return;

      const generation = generationRef.current;
      try {
        const page = await fetchRef.current({
          ...JSON.parse(key),
          limit: count,
          offset: 0,
        });
        if (!cancelled) apply(generation, page, false);
      } catch {
        // keep showing what's there; the next update or query change retries
      }
    };

    refresh();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // key deliberately absent: a query change already refetches through the effect above, and
    // listing it here would fire this one redundantly alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // ponytail: unbounded — a query scrolled 40k rows deep re-requests 40k rows on return instead
  // of resuming incrementally. Cap it if that shows up as a real complaint; today it's symmetric
  // with what the user already tolerated once.
  useEffect(() => {
    if (items.length === 0) return;
    try {
      sessionStorage.setItem(
        `resonance-paged-count:${key}`,
        String(items.length),
      );
    } catch {
      /* ignore */
    }
  }, [items, key]);

  const loadMore = useCallback(() => {
    if (
      busyRef.current ||
      !enabled ||
      itemsRef.current.length === 0 ||
      itemsRef.current.length >= totalRef.current
    ) {
      return;
    }

    busyRef.current = true;
    const generation = generationRef.current;
    const offset = itemsRef.current.length;
    setLoadingMore(true);

    (async () => {
      try {
        const page = await fetchRef.current({
          ...JSON.parse(key),
          limit: pageSize,
          offset,
        });
        apply(generation, page, true);
      } catch {
        // keep what's loaded; the next scroll retries this same offset
      } finally {
        if (mountedRef.current && generation === generationRef.current) {
          busyRef.current = false;
          setLoadingMore(false);
        }
      }
    })();
  }, [apply, enabled, key, pageSize]);

  return { items, loading, loadingMore, loadMore, total };
};

// Sorts the server can bucket into letters for the A-Z rail. null is the default (artist).
const ALPHABETICAL_SORTS = new Set([null, 'title', 'artist', 'album']);

// A paged track list plus the sort/filter/A-Z state that goes with it, ready to spread onto
// TrackTable. Every track list in the library is a filter over the same 48k rows — all tracks,
// one folder, one genre, one year — and each of them needs ordering, searching and the letter
// rail answered by the server rather than by whatever happens to be scrolled in. `baseQuery`
// is what makes each list different (e.g. { folder }, { genre }, {}).
export const usePagedTracks = (
  baseQuery,
  { defaultSort = null, enabled = true } = {},
) => {
  const [sortCol, setSortCol] = useState(defaultSort);
  const [sortDir, setSortDir] = useState('asc');
  const [letter, setLetter] = useState(null);
  const [filter, setFilter] = useState('');

  // Typing shouldn't fire a request per keystroke.
  const search = useDebounce(filter, 250);

  // Every track list in the library shows tag-derived columns, so all of them want refreshing
  // when the library reports a change — the analysis that fills in BPM and key is the common
  // case, and until this the new values only appeared if you left the view and came back.
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;

  const page = usePagedList(
    getTrackPage,
    {
      ...baseQuery,
      descending: sortDir === 'desc',
      search: search || undefined,
      sort: sortCol || undefined,
      startsWith: letter || undefined,
    },
    { enabled, refreshToken: libraryRevision },
  );

  const onAlphaJump = useCallback(
    (next) => setLetter((current) => (current === next ? null : next)),
    [],
  );

  const serverSort = useMemo(
    () => ({
      col: sortCol,
      dir: sortDir,
      onChange: (col, dir) => {
        setSortCol(col);
        setSortDir(dir);
      },
    }),
    [sortCol, sortDir],
  );

  const serverFilter = useMemo(
    () => ({ onChange: setFilter, value: filter }),
    [filter],
  );

  const reset = useCallback(() => {
    setSortCol(defaultSort);
    setSortDir('asc');
    setLetter(null);
    setFilter('');
  }, [defaultSort]);

  return {
    // The A-Z rail buckets by the column the list is ordered by (see the alphaColumn switch in
    // MusicRepository.Query), so it stays meaningful across every alphabetical sort — not just
    // the default one. Under BPM or Added, "S" is a question the ordering can't answer, and the
    // view dims the rail rather than pretending otherwise.
    alphaApplies: ALPHABETICAL_SORTS.has(sortCol) && sortDir === 'asc',
    clearLetter: useCallback(() => setLetter(null), []),
    isDefaultView:
      sortCol === defaultSort && sortDir === 'asc' && !letter && !filter,
    letter,
    reset,
    total: page.total,
    trackTableProps: {
      loading: page.loading,
      loadingMore: page.loadingMore,
      onAlphaJump,
      onEndReached: page.loadMore,
      serverFilter,
      serverSort,
      tracks: page.items,
    },
  };
};
