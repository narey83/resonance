// <copyright file="useAnalysisPages.js" company="John Narey">
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

import * as musicLibraryApi from './musicLibrary';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const ANALYSIS_TRACK_PAGE_SIZE = 200;
const keyFor = (directory, index) =>
  JSON.stringify([directory, Math.floor(index / ANALYSIS_TRACK_PAGE_SIZE)]);

// One shared page cache for the virtual list. Only visible windows are requested;
// old windows are evicted so browsing a large folder cannot retain the whole library.
export const createAnalysisPageCache = (
  query,
  notify,
  fetchPage = musicLibraryApi.getTrackPage,
) => {
  const pages = new Map();
  const queue = [];
  let active = 0;
  let disposed = false;
  const publish = () => {
    if (!disposed) notify();
  };

  const trim = () => {
    for (const [key, page] of pages) {
      if (pages.size <= 32) break;
      if (!page.loading) pages.delete(key);
    }
  };

  const worker = {
    finish(job) {
      active -= 1;
      job.loading = false;
      trim();
      publish();
      this.pump();
    },
    async run(job) {
      try {
        const result = await fetchPage(
          {
            ...query,
            folder: job.directory,
            recursive: false,
            limit: ANALYSIS_TRACK_PAGE_SIZE,
            offset: job.offset,
          },
          { signal: job.controller.signal },
        );
        if (
          !Array.isArray(result.items) ||
          !Number.isInteger(result.total) ||
          result.total < 0
        )
          throw new Error('Invalid folder page');
        if (!disposed && pages.get(job.key) === job) {
          job.items = result.items;
          job.total = result.total;
          job.error = null;
        }
      } catch (error) {
        if (!disposed && pages.get(job.key) === job) job.error = error;
      } finally {
        this.finish(job);
      }
    },
    pump() {
      if (disposed) return;
      while (active < 2 && queue.length > 0) {
        const job = queue.shift();
        active += 1;
        void this.run(job);
      }
    },
  };

  const request = (directory, index, revision) => {
    if (disposed) return;
    const key = keyFor(directory, index);
    const existing = pages.get(key);
    if (existing?.loading || existing?.revision === revision) return;
    const job = {
      key,
      directory,
      offset:
        Math.floor(index / ANALYSIS_TRACK_PAGE_SIZE) * ANALYSIS_TRACK_PAGE_SIZE,
      revision,
      items: existing?.items,
      loading: true,
      error: null,
      controller: new AbortController(),
    };
    pages.delete(key);
    pages.set(key, job);
    queue.push(job);
    publish();
    worker.pump();
  };

  return {
    get(directory, index) {
      const key = keyFor(directory, index);
      const page = pages.get(key);
      if (page) {
        pages.delete(key);
        pages.set(key, page);
      }

      return page;
    },
    request,
    setVisible(windows, revision) {
      const needed = new Set(
        windows.map((row) => keyFor(row.directory, row.index)),
      );
      for (const [key, page] of pages) {
        if (page.loading && !needed.has(key)) {
          pages.delete(key);
          page.controller.abort();
        }
      }

      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (pages.get(queue[index].key) !== queue[index])
          queue.splice(index, 1);
      }

      for (const row of windows) request(row.directory, row.index, revision);
    },
    retry(directory, index, revision) {
      pages.delete(keyFor(directory, index));
      request(directory, index, revision);
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const page of pages.values()) page.controller.abort();
      pages.clear();
    },
    get size() {
      return pages.size;
    },
  };
};

export const useAnalysisPages = (query) => {
  const [version, setVersion] = useState(0);
  const notify = useCallback(() => setVersion((value) => value + 1), []);
  const key = JSON.stringify(query);
  const cache = useMemo(
    () => createAnalysisPageCache(JSON.parse(key), notify),
    [key, notify],
  );
  useEffect(() => () => cache.dispose(), [cache]);
  return { cache, version };
};
