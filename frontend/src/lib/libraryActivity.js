// <copyright file="libraryActivity.js" company="John Narey">
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

export const getLoved = async () => (await api.get('/musiclibrary/loved')).data;

export const loveTrack = async (path) =>
  api.put('/musiclibrary/loved', { path });

export const unloveTrack = async (path) =>
  api.delete('/musiclibrary/loved', { params: { path } });

export const clearAllLoved = async () => api.delete('/musiclibrary/loved/all');

export const recordPlay = async (path) =>
  (await api.post('/musiclibrary/plays', { path })).data;

export const getPlayHistory = async (limit = 100, offset = 0) =>
  (await api.get('/musiclibrary/plays', { params: { limit, offset } })).data;

export const deletePlay = async (id) =>
  api.delete(`/musiclibrary/plays/${encodeURIComponent(id)}`);

export const clearHistory = async () => api.delete('/musiclibrary/plays');

export const getPlayStats = async (paths = null) =>
  (
    await api.get(
      '/musiclibrary/plays/stats',
      paths ? { params: { paths } } : {},
    )
  ).data;
