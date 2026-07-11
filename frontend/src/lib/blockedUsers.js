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
  blockSameIp: true,
  blockSearchResponses: true,
  blockTransfers: true,
  hideRoomMessages: true,
  hideSearchResults: true,
};

let state = {
  geoAvailable: false,
  ips: [],
  options: defaultOptions,
  places: [],
  users: [],
};

let blockedSet = new Set();
const subscribers = new Set();

const notify = () => {
  for (const subscriber of subscribers) subscriber(state);
};

const setState = (partial) => {
  state = { ...state, ...partial };
  blockedSet = new Set(state.users.map((u) => u.username.toLowerCase()));
  notify();
};

// Wired to the application hub's BLOCKED_USERS message in App.jsx.
export const applyBlockedUsers = ({
  geoAvailable,
  ips,
  options,
  places,
  users,
}) =>
  setState({
    geoAvailable: geoAvailable ?? state.geoAvailable,
    ips: ips ?? state.ips,
    options: options ?? state.options,
    places: places ?? state.places,
    users: users ?? state.users,
  });

export const getBlockedUsers = () => state;

export const isBlocked = (username) =>
  Boolean(username) && blockedSet.has(username.toLowerCase());

export const fetchBlockedUsers = async () => {
  const { data } = await api.get('/blockedusers');
  applyBlockedUsers(data ?? {});
  return state;
};

// Distinct countries and (per country) cities observed from real peer connections
// via MaxMind — the source for the block-by-location dropdowns.
export const fetchKnownLocations = async () => {
  const { data } = await api.get('/blockedusers/geo');
  return {
    citiesByCountry: data?.citiesByCountry ?? {},
    countries: data?.countries ?? [],
  };
};

export const blockUser = async (username, reason) => {
  const { data } = await api.put(
    `/blockedusers/${encodeURIComponent(username)}`,
    reason ? { reason } : {},
  );
  setState({ users: data });
  return data;
};

export const unblockUser = async (username) => {
  const { data } = await api.delete(
    `/blockedusers/${encodeURIComponent(username)}`,
  );
  setState({ users: data });
  return data;
};

export const blockIp = async (cidr, reason) => {
  const { data } = await api.post('/blockedusers/ips', { cidr, reason });
  setState({ ips: data });
  return data;
};

export const unblockIp = async (cidr) => {
  const { data } = await api.delete(
    `/blockedusers/ips?cidr=${encodeURIComponent(cidr)}`,
  );
  setState({ ips: data });
  return data;
};

export const blockPlace = async (country, city, reason) => {
  const { data } = await api.post('/blockedusers/places', {
    city,
    country,
    reason,
  });
  setState({ places: data });
  return data;
};

export const unblockPlace = async (id) => {
  const { data } = await api.delete(`/blockedusers/places/${id}`);
  setState({ places: data });
  return data;
};

export const setBlockedUserOptions = async (options) => {
  const { data } = await api.put('/blockedusers/options', options);
  setState({ options: data });
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
