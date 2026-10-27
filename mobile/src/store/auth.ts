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
import { Platform } from 'react-native';
import { create } from 'zustand';
import { accountScope, decodeJwt } from '../lib/jwt';
import { getSessionGeneration, isCurrentSession, resetSessionScope } from '../lib/sessionScope';

const KEYS = {
  serverUrl:    'resonance_server_url',
  accessToken:  'resonance_access_token',
  refreshToken: 'resonance_refresh_token',
  sessionId:    'resonance_session_id',
  deviceName:   'resonance_device_name',
  deviceId:     'resonance_device_id',
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
    const payload = decodeJwt(token);
    const claim = payload?.[ROLE_CLAIM] ?? payload?.role;
    const role = typeof claim === 'string' ? claim : null;
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
  hydrationError: string | null;

  hydrate: ()                                                                    => Promise<void>;
  setServerUrl: (url: string)                                                    => Promise<void>;
  setTokens: (access: string, refresh: string, sessionId?: string | null,
    options?: { generation: number; refresh?: boolean }) => Promise<void>;
  clearTokens: ()                                                                => Promise<void>;
  clearAll: ()                                                                   => Promise<void>;
}

// Keep credential writes ordered: a slow refresh write must finish before a later logout
// deletes it, and neither may race a new login's writes.
let storageTail: Promise<unknown> = Promise.resolve();
const storeCredentials = <T>(work: () => Promise<T>): Promise<T> => {
  const next = storageTail.then(work, work);
  storageTail = next.catch(() => {});
  return next;
};
// Promise.all rejects before the remaining native writes finish. Wait for every write before
// allowing the next queued login/logout to touch those keys, even when one operation fails.
const settleWrites = async (operations: Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(operations);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
};
// CarPlay may restore its existing session while the phone is locked. Biometric
// saved-server passwords remain separately protected; only session keys use this class.
const SESSION_STORAGE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
let hydration: Promise<void> | null = null;
const signedOut = {
  accessToken: null, refreshToken: null, sessionId: null,
  role: null, isAdmin: false, tokenExpiresAt: null,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  serverUrl: null,
  ...signedOut,
  isReady: false,
  hydrationError: null,

  hydrate: () => {
    if (hydration) return hydration;
    const started = getSessionGeneration();
    set({ hydrationError: null, isReady: false });
    hydration = storeCredentials(async () => {
      try {
        const [serverUrl, accessToken, refreshToken, sessionId] = await Promise.all([
          SecureStore.getItemAsync(KEYS.serverUrl),
          SecureStore.getItemAsync(KEYS.accessToken),
          SecureStore.getItemAsync(KEYS.refreshToken),
          SecureStore.getItemAsync(KEYS.sessionId),
        ]);
        if (!isCurrentSession(started)) return;
        // Migrate older session entries after the first unlocked launch of this build.
        await Promise.allSettled(([
          [KEYS.serverUrl, serverUrl], [KEYS.accessToken, accessToken],
          [KEYS.refreshToken, refreshToken], [KEYS.sessionId, sessionId],
        ] as const).filter(([, value]) => value !== null)
          .map(([key, value]) => SecureStore.setItemAsync(key, value!, SESSION_STORAGE)));
        if (!isCurrentSession(started)) return;
        resetSessionScope(accountScope(serverUrl, accessToken), true);
        const { role, expiresAt } = decodeToken(accessToken);
        set({ serverUrl, accessToken, refreshToken, sessionId, role, isAdmin: role === 'Administrator', tokenExpiresAt: expiresAt, isReady: true });
      } catch {
        if (isCurrentSession(started)) {
          set({ isReady: true, hydrationError: 'Could not read saved sign-in details. Please try again.' });
        }
      }
    }).finally(() => { hydration = null; });
    return hydration;
  },

  setServerUrl: async (url) => {
    const changed = url !== get().serverUrl;
    const clearCredentials = changed || !get().accessToken;
    if (changed) {
      set({ serverUrl: url, ...signedOut, isReady: true });
      resetSessionScope(null);
    }
    const started = getSessionGeneration();
    await storeCredentials(async () => {
      if (!isCurrentSession(started)) return;
      if (clearCredentials) await settleWrites([
        SecureStore.deleteItemAsync(KEYS.accessToken),
        SecureStore.deleteItemAsync(KEYS.refreshToken),
        SecureStore.deleteItemAsync(KEYS.sessionId),
      ]);
      await SecureStore.setItemAsync(KEYS.serverUrl, url, SESSION_STORAGE);
    });
  },

  setTokens: async (access, refresh, sessionId, options) => {
    const expectedGeneration = options?.generation;
    const refreshOnly = options?.refresh ?? false;
    if (expectedGeneration !== undefined && !isCurrentSession(expectedGeneration)) return;
    if (!refreshOnly) {
      set(signedOut);
      resetSessionScope(accountScope(get().serverUrl, access));
    }
    const started = getSessionGeneration();
    const nextSessionId = sessionId ?? (refreshOnly ? get().sessionId : null);
    await storeCredentials(async () => {
      if (!isCurrentSession(started)) return;
      try {
        await settleWrites([
          SecureStore.setItemAsync(KEYS.accessToken, access, SESSION_STORAGE),
          SecureStore.setItemAsync(KEYS.refreshToken, refresh, SESSION_STORAGE),
          nextSessionId === null
            ? SecureStore.deleteItemAsync(KEYS.sessionId)
            : SecureStore.setItemAsync(KEYS.sessionId, nextSessionId, SESSION_STORAGE),
        ]);
      } catch (error) {
        // A partially saved token pair must never become the next startup's credentials.
        await settleWrites([
          SecureStore.deleteItemAsync(KEYS.accessToken),
          SecureStore.deleteItemAsync(KEYS.refreshToken),
          SecureStore.deleteItemAsync(KEYS.sessionId),
        ]).catch(() => {});
        if (isCurrentSession(started)) {
          set(signedOut);
          resetSessionScope(null);
        }
        throw error;
      }
    });
    if (!isCurrentSession(started)) return;
    const { role, expiresAt } = decodeToken(access);
    set({ accessToken: access, refreshToken: refresh, sessionId: nextSessionId,
      role, isAdmin: role === 'Administrator', tokenExpiresAt: expiresAt, isReady: true, hydrationError: null });
  },

  clearTokens: async () => {
    set({ ...signedOut, isReady: true });
    resetSessionScope(null);
    await storeCredentials(() => settleWrites([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      SecureStore.deleteItemAsync(KEYS.sessionId),
    ]));
  },

  clearAll: async () => {
    set({ serverUrl: null, ...signedOut, isReady: true });
    resetSessionScope(null);
    await storeCredentials(() => settleWrites(
      Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)),
    ));
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

// A stable per-install identifier, distinct from the human-readable deviceName above, so the
// backend can tell "same phone logging in again" from "a new device" even if deviceName's random
// suffix ever gets regenerated. Android ID / iOS identifierForVendor survive an app reinstall
// (they're tied to the device, not to this app's storage) — a random value stashed in SecureStore
// does not, which was the root cause of duplicate sessions for one physical device.
export const getDeviceId = async (): Promise<string> => {
  const Application = await import('expo-application');

  if (Platform.OS === 'android') {
    const id = Application.getAndroidId();
    if (id) return id;
  } else if (Platform.OS === 'ios') {
    const id = await Application.getIosIdForVendorAsync();
    if (id) return id;
  }

  // Fallback (web, or the rare case the platform id comes back empty): a random id persisted
  // in SecureStore. Not as durable as the platform id, but only used when that's unavailable.
  const stored = await SecureStore.getItemAsync(KEYS.deviceId);
  if (stored) return stored;
  const generated = randomHex8() + randomHex8();
  await SecureStore.setItemAsync(KEYS.deviceId, generated);
  return generated;
};
