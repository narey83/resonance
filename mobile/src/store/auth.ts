// <copyright file="auth.ts" company="John Narey">
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

import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const KEYS = {
  serverUrl:    'resonance_server_url',
  accessToken:  'resonance_access_token',
  refreshToken: 'resonance_refresh_token',
  sessionId:    'resonance_session_id',
  deviceName:   'resonance_device_name',
};

// ASP.NET Core issues the role claim under the long claim-type URI, not a
// short "role" key — matches the decoding done by the web frontend's
// lib/token.js so both clients agree on who's an admin.
const ROLE_CLAIM = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';

interface DecodedToken {
  role:      string | null;
  expiresAt: number | null; // ms epoch
}

const decodeToken = (token: string | null): DecodedToken => {
  if (!token) return { role: null, expiresAt: null };
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const role = payload?.[ROLE_CLAIM] ?? payload?.role ?? null;
    const expiresAt = typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
    return { role, expiresAt };
  } catch {
    return { role: null, expiresAt: null };
  }
};

interface AuthState {
  serverUrl:    string | null;
  accessToken:  string | null;
  refreshToken: string | null;
  sessionId:    string | null;
  role:         string | null;
  isAdmin:      boolean;
  tokenExpiresAt: number | null; // ms epoch, decoded from the JWT `exp` claim
  isReady:      boolean; // true once SecureStore has been read on startup

  hydrate: ()                                                                    => Promise<void>;
  setServerUrl: (url: string)                                                    => Promise<void>;
  setTokens: (access: string, refresh: string, sessionId?: string | null)       => Promise<void>;
  clearTokens: ()                                                                => Promise<void>;
  clearAll: ()                                                                   => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  serverUrl:    null,
  accessToken:  null,
  refreshToken: null,
  sessionId:    null,
  role:         null,
  isAdmin:      false,
  tokenExpiresAt: null,
  isReady:      false,

  hydrate: async () => {
    const [serverUrl, accessToken, refreshToken, sessionId] = await Promise.all([
      SecureStore.getItemAsync(KEYS.serverUrl),
      SecureStore.getItemAsync(KEYS.accessToken),
      SecureStore.getItemAsync(KEYS.refreshToken),
      SecureStore.getItemAsync(KEYS.sessionId),
    ]);
    const { role, expiresAt } = decodeToken(accessToken);
    set({ serverUrl, accessToken, refreshToken, sessionId, role, isAdmin: role === 'Administrator', tokenExpiresAt: expiresAt, isReady: true });
  },

  setServerUrl: async (url) => {
    await SecureStore.setItemAsync(KEYS.serverUrl, url);
    set({ serverUrl: url });
  },

  setTokens: async (access, refresh, sessionId) => {
    const ops: Promise<void>[] = [
      SecureStore.setItemAsync(KEYS.accessToken, access),
      SecureStore.setItemAsync(KEYS.refreshToken, refresh),
    ];
    if (sessionId != null) ops.push(SecureStore.setItemAsync(KEYS.sessionId, sessionId));
    await Promise.all(ops);
    const { role, expiresAt } = decodeToken(access);
    set((s) => ({
      accessToken: access,
      refreshToken: refresh,
      sessionId: sessionId ?? s.sessionId,
      role,
      isAdmin: role === 'Administrator',
      tokenExpiresAt: expiresAt,
    }));
  },

  clearTokens: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      SecureStore.deleteItemAsync(KEYS.sessionId),
    ]);
    set({ accessToken: null, refreshToken: null, sessionId: null, role: null, isAdmin: false, tokenExpiresAt: null });
  },

  clearAll: async () => {
    await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
    set({ serverUrl: null, accessToken: null, refreshToken: null, sessionId: null, role: null, isAdmin: false, tokenExpiresAt: null });
  },
}));

const randomHex8 = () =>
  Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');

export const getDeviceName = async (): Promise<string> => {
  const stored = await SecureStore.getItemAsync(KEYS.deviceName);
  if (stored && /\([0-9a-f]{8}\)$/.test(stored)) return stored;

  const { default: Constants } = await import('expo-constants');
  const base = stored?.replace(/\s*\(.*\)$/, '').trim() ?? Constants.deviceName ?? 'Mobile';
  const name = `${base} (${randomHex8()})`;
  await SecureStore.setItemAsync(KEYS.deviceName, name);
  return name;
};
