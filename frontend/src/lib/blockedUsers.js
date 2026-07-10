// <copyright file="blockedUsers.js" company="John Narey">
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
import { useEffect, useState } from 'react';

// Server-backed blocked user list, shared across web and mobile. The
// application hub pushes the current list + options on connect and after
// every mutation ('BLOCKED_USERS'), so blocked state is live everywhere a
// username is rendered without per-component fetches.

const defaultOptions = {
  blockBrowse: true,
  blockPrivateMessages: true,
  blockSearchResponses: true,
  blockTransfers: true,
  hideRoomMessages: true,
  hideSearchResults: true,
};

let state = {
  options: defaultOptions,
  users: [],
};

let blockedSet = new Set();
const subscribers = new Set();

const notify = () => {
  for (const subscriber of subscribers) subscriber(state);
};

const setState = (users, options) => {
  state = {
    options: options ?? state.options,
    users: users ?? state.users,
  };

  blockedSet = new Set(state.users.map((u) => u.username.toLowerCase()));
  notify();
};

// Wired to the application hub's BLOCKED_USERS message in App.jsx.
export const applyBlockedUsers = ({ options, users }) =>
  setState(users, options);

export const getBlockedUsers = () => state;

export const isBlocked = (username) =>
  Boolean(username) && blockedSet.has(username.toLowerCase());

export const fetchBlockedUsers = async () => {
  const { data } = await api.get('/blockedusers');
  setState(data?.users ?? [], data?.options);
  return state;
};

export const blockUser = async (username, reason) => {
  const { data } = await api.put(
    `/blockedusers/${encodeURIComponent(username)}`,
    reason ? { reason } : {},
  );
  setState(data);
  return data;
};

export const unblockUser = async (username) => {
  const { data } = await api.delete(
    `/blockedusers/${encodeURIComponent(username)}`,
  );
  setState(data);
  return data;
};

export const setBlockedUserOptions = async (options) => {
  const { data } = await api.put('/blockedusers/options', options);
  setState(undefined, data);
  return data;
};

// Subscribes a component to the blocked list; re-renders on every change.
export const useBlockedUsers = () => {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    subscribers.add(setSnapshot);
    if (state !== snapshot) setSnapshot(state);
    return () => subscribers.delete(setSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return snapshot;
};
