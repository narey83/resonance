// <copyright file="connectionMonitor.ts" company="John Narey">
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

import { useEffect } from 'react';
import axios, { AxiosError } from 'axios';
import * as Network from 'expo-network';
import { create } from 'zustand';
import { useAuthStore } from '../store/auth';
import { getValidToken } from '../api/client';
import { remoteLog } from '../api/remoteLogger';

export type ConnectionStatus = 'connected' | 'slow' | 'down' | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
  latencyMs: number | null;
  lastError: string | null;
  isCellular: boolean;
  networkSwitchedAt: number | null;
  _setStatus: (status: ConnectionStatus, latencyMs?: number | null, error?: string | null) => void;
  _setNetworkSwitchedAt: (ts: number) => void;
  _setIsCellular: (isCellular: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connected',
  latencyMs: null,
  lastError: null,
  isCellular: false,
  networkSwitchedAt: null,
  _setStatus: (status, latencyMs = null, error = null) => set({ status, latencyMs, lastError: error }),
  _setNetworkSwitchedAt: (ts) => set({ networkSwitchedAt: ts }),
  _setIsCellular: (isCellular) => set({ isCellular }),
}));

const INTERVAL_OK       = 12_000;
const INTERVAL_DEGRADED =  5_000;
const SLOW_MS           =  1_500;
const TIMEOUT_MS        =  8_000;

async function pingServer(serverUrl: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await axios.get(`${serverUrl}/api/v0/session/initialized`, { timeout: TIMEOUT_MS });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    const err = e as AxiosError;
    // Categorise so the failure is diagnosable on-device (the remote logger can't
    // flush while the server is unreachable). HTTP status ⇒ reached the server;
    // timeout/network ⇒ never got a response.
    const error = err.response
      ? `HTTP ${err.response.status}`
      : err.code === 'ECONNABORTED'
        ? `timeout ${TIMEOUT_MS}ms`
        : err.code ?? err.message ?? 'network error';
    return { ok: false, latencyMs: Date.now() - start, error };
  }
}

// ── Module-level singleton monitor ──────────────────────────────────────────
// The polling loop and network listener live at module scope, guarded by a
// refcount, so there is *exactly one* connection regardless of how many times
// the hook mounts. Tying the loop to a component effect used to let stale
// timer-driven loops survive a remount / Fast Refresh, which produced multiple
// pings in lockstep (each with its own status closure logging the same
// transitions). A module singleton can't be duplicated by re-mounting.

let refCount = 0;
let running = false;
let serverUrl: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let netSub: { remove: () => void } | null = null;
let switchTimer: ReturnType<typeof setTimeout> | null = null;
let lastNetType: Network.NetworkStateType | null = null;

const statusNow = () => useConnectionStore.getState().status;
const store = () => useConnectionStore.getState();

function schedule() {
  if (!running) return;
  const delay = statusNow() === 'connected' ? INTERVAL_OK : INTERVAL_DEGRADED;
  pollTimer = setTimeout(check, delay);
}

async function check() {
  if (!running || !serverUrl) return;

  const net = await Network.getNetworkStateAsync();
  if (!running) return;
  // isConnected can be null on some Android versions; treat null as "maybe connected"
  if (net.isConnected === false) {
    if (statusNow() !== 'offline') remoteLog('warn', '[conn] device offline');
    store()._setStatus('offline');
    schedule();
    return;
  }

  const { ok, latencyMs, error } = await pingServer(serverUrl);
  if (!running) return;

  const prev = statusNow();
  if (!ok) {
    if (prev !== 'down') remoteLog('warn', `[conn] server unreachable (ping=${latencyMs}ms, ${error})`);
    store()._setStatus('down', null, error ?? null);
  } else if (latencyMs > SLOW_MS) {
    if (prev !== 'slow') remoteLog('warn', `[conn] server slow (latency=${latencyMs}ms)`);
    else remoteLog('info', `[conn] slow ping=${latencyMs}ms`);
    store()._setStatus('slow', latencyMs);
  } else {
    if (prev !== 'connected') {
      remoteLog('info', `[conn] server reachable (latency=${latencyMs}ms)`);
      // Reconnecting from a down/offline state — proactively refresh the access token
      // so stream URLs and API calls are ready. If the refresh token has expired or been
      // revoked, doRefresh calls clearTokens() which navigates the user back to login.
      if (prev === 'down' || prev === 'offline') {
        getValidToken()
          .then((t) => remoteLog('info', `[conn] token ${t ? 'refreshed' : 'expired — logging out'} after reconnect`))
          .catch(() => remoteLog('warn', '[conn] token refresh error after reconnect'));
      }
    }
    store()._setStatus('connected', latencyMs);
  }

  schedule();
}

// Force an immediate ping, cancelling any pending scheduled poll first so the
// two don't run as overlapping loops. Used by the network-switch listener.
function checkNow() {
  if (!running) return;
  if (pollTimer) clearTimeout(pollTimer);
  check();
}

function startMonitor(url: string) {
  serverUrl = url;
  if (running) return; // idempotent — never spin up a second loop
  running = true;

  // Detect network type switches (e.g. cellular → wifi) and signal them so
  // long-lived resources (audio stream) can recover proactively.
  Network.getNetworkStateAsync().then((s) => {
    lastNetType = s.type ?? null;
    store()._setIsCellular(s.type === Network.NetworkStateType.CELLULAR);
  });

  netSub = Network.addNetworkStateListener((s) => {
    const currentType = s.type ?? null;
    store()._setIsCellular(currentType === Network.NetworkStateType.CELLULAR);
    if (lastNetType !== null && currentType !== lastNetType) {
      remoteLog('info', `[net] type changed: ${lastNetType} → ${currentType} (isConnected=${s.isConnected})`);
      if (s.isConnected) {
        store()._setNetworkSwitchedAt(Date.now());
        // Give the new interface a moment to establish a route, then actively
        // re-ping. We deliberately don't flip status to 'down' here: that only
        // changed the banner text without triggering a poll, so it showed
        // "Server unreachable" until the next scheduled check (up to INTERVAL_OK
        // later) even when the server was reachable on the new network.
        if (switchTimer) clearTimeout(switchTimer);
        switchTimer = setTimeout(checkNow, 800);
      }
    }
    lastNetType = currentType;
  });

  // Short delay on start so we don't fire immediately on every auth state change
  pollTimer = setTimeout(check, 3_000);
}

function stopMonitor() {
  running = false;
  serverUrl = null;
  lastNetType = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
  if (netSub) { netSub.remove(); netSub = null; }
}

export function useConnectionMonitor() {
  const url = useAuthStore((s) => s.serverUrl);

  useEffect(() => {
    if (!url) return;
    refCount += 1;
    startMonitor(url); // idempotent; also refreshes serverUrl if it changed

    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        stopMonitor();
      }
    };
  }, [url]);
}
