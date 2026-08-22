// <copyright file="server.ts" company="John Narey">
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

// Mirrors the web frontend's lib/server.js connect/disconnect calls — the
// Soulseek network login is independent of the app session (auth.ts), so
// signing out here never touches the JWT/refresh token.

import { apiClient } from './client';

export const connectToSoulseek = () => apiClient.put('/server');

// The backend binds this as [FromBody] string, i.e. a raw JSON string, not an
// object — JSON.stringify-ing the message ourselves (rather than passing the
// bare string, which axios would send unquoted and fail model binding) is
// required, matching the frontend's exact call shape. Axios only infers a
// application/json Content-Type when it does the stringifying itself; since
// the body here arrives pre-stringified, the header has to be set explicitly
// or the controller's [Consumes("application/json")] rejects the request.
export const disconnectFromSoulseek = (message = 'client disconnected from mobile app') =>
  apiClient.delete('/server', {
    data: JSON.stringify(message),
    headers: { 'Content-Type': 'application/json' },
  });

// ── Soulseek profile (picture + tagline) ────────────────────────────────────
// The backend gates the description and picture writes to administrators
// only (see ServerController.SetStatus / UploadPicture / DeletePicture) —
// setting presence has no such restriction. Callers should check
// useAuthStore's `isAdmin` before showing edit controls.

export interface SoulseekStatus {
  presence:    string;
  description: string;
  hasPicture:  boolean;
}

export const getSoulseekStatus = () =>
  apiClient.get<SoulseekStatus>('/server/status').then(r => r.data);

export const setSoulseekStatus = (body: { presence?: 'Online' | 'Away'; description?: string }) =>
  apiClient.put<SoulseekStatus>('/server/status', body).then(r => r.data);

// The picture lives at a fixed path, so callers pass a cache-busting version
// (e.g. a counter bumped after every change) to force a re-fetch. Built from
// the raw server URL rather than apiClient, since <Image> needs an absolute
// URI outside of axios and the endpoint is anonymous (no auth header needed).
export const soulseekPictureUrl = (serverUrl: string | null, version: number): string | null =>
  serverUrl ? `${serverUrl}/api/v0/server/picture?v=${version}` : null;

export const uploadSoulseekPicture = async (uri: string): Promise<void> => {
  const form = new FormData();
  const filename = uri.split('/').pop() ?? 'picture.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name: filename, type } as any);
  await apiClient.post('/server/picture', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const deleteSoulseekPicture = () => apiClient.delete('/server/picture');
