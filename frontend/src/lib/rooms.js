// <copyright file="rooms.js" company="JP Dillingham">
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

export const getAvailable = async () => {
  const response = (await api.get('/rooms/available')).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from rooms API', response);
    return undefined;
  }

  return response;
};

export const getJoined = async () => {
  const response = (await api.get('/rooms/joined')).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from rooms API', response);
    return undefined;
  }

  return response;
};

export const getMessages = async ({ roomName }) => {
  const response = (
    await api.get(`/rooms/joined/${encodeURIComponent(roomName)}/messages`)
  ).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from rooms API', response);
    return undefined;
  }

  return response;
};

export const getUsers = async ({ roomName }) => {
  const response = (
    await api.get(`/rooms/joined/${encodeURIComponent(roomName)}/users`)
  ).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from rooms API', response);
    return undefined;
  }

  return response;
};

export const join = async ({ roomName }) => {
  return api.post('/rooms/joined', roomName);
};

export const leave = async ({ roomName }) => {
  return api.delete(`/rooms/joined/${encodeURIComponent(roomName)}`);
};

export const sendMessage = async ({ roomName, message }) => {
  return api.post(
    `/rooms/joined/${encodeURIComponent(roomName)}/messages`,
    JSON.stringify(message),
  );
};

export const getMessageCounts = async () =>
  (await api.get('/rooms/joined/message-counts')).data;
