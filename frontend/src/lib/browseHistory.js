// <copyright file="browseHistory.js" company="John Narey">
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

import * as prefs from './prefs';

const BROWSE_HISTORY_KEY = 'resonance-browse-history';
const MAX_HISTORY = 25;

export const getBrowseHistory = () => {
  const value = prefs.get(BROWSE_HISTORY_KEY, []);
  return Array.isArray(value) ? value : [];
};

// Moves `username` to the front, case-insensitively deduplicated, and returns
// the updated list so callers can sync it straight into state.
export const addToBrowseHistory = (username) => {
  if (!username?.trim()) return getBrowseHistory();
  const next = [
    username,
    ...getBrowseHistory().filter(
      (u) => u.toLowerCase() !== username.toLowerCase(),
    ),
  ].slice(0, MAX_HISTORY);
  prefs.set(BROWSE_HISTORY_KEY, next);
  return next;
};

export const removeFromBrowseHistory = (username) => {
  const next = getBrowseHistory().filter(
    (u) => u.toLowerCase() !== username.toLowerCase(),
  );
  prefs.set(BROWSE_HISTORY_KEY, next);
  return next;
};
