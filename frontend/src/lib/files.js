// <copyright file="files.js" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import api from './api';
import { signedQuery } from './streamSignatures';
import { getToken, isPassthroughEnabled } from './token';

export const getLocalStreamUrl = (path, seekableMp3 = false) => {
  // Absolute paths are music library tracks; relative paths are downloaded files
  if (path.startsWith('/')) {
    // Library tracks authenticate via a path-scoped signature (warmed by the library fetchers),
    // not the account token.
    const container =
      seekableMp3 && /\.mp3$/i.test(path) ? '&container=mp4' : '';
    return `/api/v0/musiclibrary/stream?path=${encodeURIComponent(path)}${signedQuery(path)}${container}`;
  }

  const token = isPassthroughEnabled() ? null : getToken();
  const tokenParameter = token
    ? `&access_token=${encodeURIComponent(token)}`
    : '';
  return `/api/v0/files/downloads/stream?path=${encodeURIComponent(path)}${tokenParameter}`;
};

export const browseDirectories = async (path = '/') => {
  const response = await api.get('/files/directories', { params: { path } });
  return response.data;
};

export const createDirectory = async (path) => {
  const response = await api.post('/files/directories', { path });
  return response.data;
};

export const list = async ({ root, subdirectory = '' }) => {
  const response = (
    await api.get(`/files/${root}/directories/${btoa(subdirectory)}`)
  ).data;

  return response;
};

export const deleteDirectory = async ({ root, path }) => {
  const response = await api.delete(`/files/${root}/directories/${btoa(path)}`);

  return response;
};

export const deleteFile = async ({ root, path }) => {
  const response = await api.delete(`/files/${root}/files/${btoa(path)}`);

  return response;
};
