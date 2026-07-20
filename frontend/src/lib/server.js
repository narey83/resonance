// <copyright file="server.js" company="JP Dillingham">
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

import { apiBaseUrl } from '../config';
import api from './api';

export const getState = async () => {
  return (await api.get('/server')).data;
};

export const getApplicationState = async () => {
  return (await api.get('/application')).data;
};

export const connect = () => {
  return api.put('/server');
};

export const disconnect = ({
  message = 'client disconnected from web UI',
} = {}) => {
  return api.delete('/server', { data: JSON.stringify(message) });
};

export const getBrowseRateLimitUsers = async () => {
  return (await api.get('/browse-rate-limit/users')).data;
};

export const unblockBrowseRateLimitUser = (username) => {
  return api.delete(`/browse-rate-limit/users/${encodeURIComponent(username)}`);
};

export const getTransferErrorNotifications = async () => {
  return (await api.get('/transfer-error-notifications')).data;
};

export const checkPort = async () => {
  return (await api.get('/server/port-check')).data;
};

// ── Profile picture ───────────────────────────────────────────────────────────

// The picture lives at a fixed path, so callers pass a cache-busting version
// (e.g. a timestamp) to force the browser to re-fetch after a change.
export const pictureUrl = (version) =>
  `${apiBaseUrl}/server/picture${version ? `?v=${version}` : ''}`;

export const uploadPicture = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/server/picture', form);
};

export const deletePicture = () => {
  return api.delete('/server/picture');
};
