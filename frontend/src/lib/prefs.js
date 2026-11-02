// <copyright file="prefs.js" company="John Narey">
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

import api from './api';

// In-memory cache of all preferences. null = not yet loaded from server.
let cache = null;

// Keep unacknowledged changes across reloads, separately from cached server values.
const pendingPrefix = 'resonance-pending-preference:';
const pending = Object.create(null);
try {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(pendingPrefix)) continue;
    try {
      pending[key.slice(pendingPrefix.length)] = JSON.parse(
        localStorage.getItem(key),
      );
    } catch {
      /* Ignore malformed local entries. */
    }
  }
} catch {
  /* Storage may be unavailable; retain in-memory saving. */
}

let flushTimer = null;
let flushing = false;
let revision = 0;

const scheduleFlush = (save) => {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(save, 600);
};

const flush = () => {
  if (flushing || !Object.keys(pending).length) return;
  const patch = { ...pending };
  const sentRevision = revision;
  flushing = true;
  api
    .patch('/preferences', patch)
    .then(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (pending[key] === value) delete pending[key];
        try {
          // A newer change from this or another tab must remain queued.
          if (
            localStorage.getItem(pendingPrefix + key) === JSON.stringify(value)
          ) {
            localStorage.removeItem(pendingPrefix + key);
          }
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {
      // Keep the pending values for the next load or edit to retry.
    })
    .finally(() => {
      flushing = false;
      if (revision !== sentRevision && Object.keys(pending).length)
        scheduleFlush(flush);
    });
};

// Load all preferences from the server and populate the in-memory cache.
// Syncs server values back to localStorage so any component that still reads
// localStorage directly picks up the correct value on the next page load.
export const load = async () => {
  try {
    const { data } = await api.get('/preferences');
    cache = { ...data, ...pending };
    for (const [key, value] of Object.entries(cache)) {
      try {
        localStorage.setItem(
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    cache = { ...pending };
  }

  if (Object.keys(pending).length) scheduleFlush(flush);
  return cache;
};

// Read a preference.  Falls back to localStorage then `defaultValue` until
// the server load completes.
export const get = (key, defaultValue = null) => {
  if (Object.prototype.hasOwnProperty.call(pending, key)) return pending[key];
  if (cache !== null && Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  }

  const raw = localStorage.getItem(key);
  if (raw !== null) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return defaultValue;
};

// Write a preference: updates the cache, localStorage, and schedules a
// debounced PATCH to the server.
export const set = (key, value) => {
  if (cache === null) cache = {};
  cache[key] = value;
  try {
    localStorage.setItem(pendingPrefix + key, JSON.stringify(value));
    localStorage.setItem(
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  } catch {
    /* ignore */
  }

  pending[key] = value;
  revision += 1;
  scheduleFlush(flush);
};
