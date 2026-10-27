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
import { AppState } from 'react-native';
import axios, { AxiosError } from 'axios';
import * as Network from 'expo-network';
import { create } from 'zustand';
import { useAuthStore } from '../store/auth';
import { useAppMode } from '../store/appModeStore';
import { isMaintenanceResponse } from '../lib/maintenance';
import { getValidToken } from '../api/client';
import { remoteLog } from '../api/remoteLogger';

export type ConnectionStatus = 'connected' | 'slow' | 'down' | 'offline' | 'maintenance';

interface ConnectionState {
  status: ConnectionStatus;
  latencyMs: number | null;
  lastError: string | null;
  isCellular: boolean;
  networkSwitchedAt: number | null;
  /**
   * True once playback has repeatedly run dry -- the buffer emptied mid-track while the user
   * was listening. Diagnostic only: it is reported, not acted on.
   *
   * It is the honest measure of whether the link is keeping up, in a way ping latency is not.
   * Latency says nothing about sustained throughput (30-120s of buffer absorbs a late answer
   * without the listener hearing a gap), and it measures the server as much as the network --
   * a server busy on its disks answers slowly over a perfectly good link.
   *
   * Nothing downgrades quality off this flag, because the only lever available is transcoding
   * and that asks more of the server, not less. See resolveStreamQuality in api/musicLibrary.
   */
  streamStruggling: boolean;
  _setStatus: (status: ConnectionStatus, latencyMs?: number | null, error?: string | null) => void;
  _setNetworkSwitchedAt: (ts: number) => void;
  _setIsCellular: (isCellular: boolean) => void;
  _setStreamStruggling: (streamStruggling: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connected',
  latencyMs: null,
  lastError: null,
  isCellular: false,
  networkSwitchedAt: null,
  streamStruggling: false,
  _setStatus: (status, latencyMs = null, error = null) => set({ status, latencyMs, lastError: error }),
  _setNetworkSwitchedAt: (ts) => set({ networkSwitchedAt: ts }),
  _setIsCellular: (isCellular) => set({ isCellular }),
  _setStreamStruggling: (streamStruggling) => set({ streamStruggling }),
}));

const INTERVAL_OK       = 12_000;
const INTERVAL_DEGRADED =  5_000;
const SLOW_MS           =  1_500;
const TIMEOUT_MS        =  8_000;

// Native network inspection can reject or stall while Android changes interfaces.
// It is only a hint: a bounded HTTP probe remains the authority on server reachability.
function networkState(): Promise<Network.NetworkState | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2_500);
    Promise.resolve().then(() => Network.getNetworkStateAsync()).then(
      (state) => { clearTimeout(timer); resolve(state); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

async function pingServer(url: string, signal: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: string; maintenance?: boolean }> {
  const start = Date.now();
  try {
    await axios.get(`${url}/api/v0/session/initialized`, { timeout: TIMEOUT_MS, signal });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    const err = e as AxiosError;
    if (isMaintenanceResponse(err.response)) {
      return { ok: false, latencyMs: Date.now() - start, maintenance: true };
    }
    const error = err.response
      ? `HTTP ${err.response.status}`
      : err.code === 'ECONNABORTED'
        ? `timeout ${TIMEOUT_MS}ms`
        : err.code ?? err.message ?? 'network error';
    return { ok: false, latencyMs: Date.now() - start, error };
  }
}

let refCount = 0;
let running = false;
let serverUrl: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let netSub: { remove: () => void } | null = null;
let appSub: { remove: () => void } | null = null;
let switchTimer: ReturnType<typeof setTimeout> | null = null;
let lastNetType: Network.NetworkStateType | null = null;
let monitorGeneration = 0;
let checkGeneration = 0;
let requestAbort: AbortController | null = null;

const statusNow = () => useConnectionStore.getState().status;
const store = () => useConnectionStore.getState();

function schedule() {
  if (!running) return;
  if (pollTimer) clearTimeout(pollTimer);
  const delay = statusNow() === 'connected' ? INTERVAL_OK : INTERVAL_DEGRADED;
  pollTimer = setTimeout(() => { pollTimer = null; void check(); }, delay);
}

async function check() {
  const url = serverUrl;
  if (!running || !url) return;
  const generation = ++checkGeneration;
  requestAbort?.abort();
  const abort = new AbortController();
  requestAbort = abort;
  const current = () => running && generation === checkGeneration && url === serverUrl;
  try {
    const net = await networkState();
    if (!current()) return;
    if (net?.isConnected === false) {
      if (statusNow() !== 'offline') remoteLog('warn', '[conn] device offline');
      store()._setStatus('offline');
      return;
    }

    const { ok, latencyMs, error, maintenance } = await pingServer(url, abort.signal);
    if (!current()) return;
    const prev = statusNow();
    if (maintenance) {
      store()._setStatus('maintenance');
    } else if (!ok) {
      if (prev !== 'down') remoteLog('warn', `[conn] server unreachable (ping=${latencyMs}ms, ${error})`);
      store()._setStatus('down', null, error ?? null);
    } else {
      const status = latencyMs > SLOW_MS ? 'slow' : 'connected';
      if (prev !== status) remoteLog('info', `[conn] server reachable (${status}, latency=${latencyMs}ms)`);
      store()._setStatus(status, latencyMs);
      if (prev === 'down' || prev === 'offline' || prev === 'maintenance') {
        getValidToken().then((token) => {
          if (current()) remoteLog('info', `[conn] token ${token ? 'ready' : 'expired — logging out'} after reconnect`);
        }).catch(() => {
          if (current()) remoteLog('warn', '[conn] token refresh error after reconnect');
        });
      }
    }
  } catch {
    if (current()) store()._setStatus('down', null, 'Connection check failed; retrying');
  } finally {
    // Old requests must neither overwrite a newer result nor resurrect a stopped loop.
    if (current()) { requestAbort = null; schedule(); }
  }
}

function checkNow() {
  if (!running) return;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  void check();
}

function startMonitor(url: string) {
  const changed = serverUrl !== url;
  serverUrl = url;
  if (running) { if (changed) checkNow(); return; }
  running = true;
  const generation = ++monitorGeneration;
  const current = () => running && generation === monitorGeneration;
  void networkState().then((state) => {
    if (!current() || !state) return;
    lastNetType = state.type ?? null;
    store()._setIsCellular(state.type === Network.NetworkStateType.CELLULAR);
  });
  try {
    netSub = Network.addNetworkStateListener((state) => {
      if (!current()) return;
      const type = state.type ?? null;
      store()._setIsCellular(type === Network.NetworkStateType.CELLULAR);
      if (lastNetType !== null && type !== lastNetType && state.isConnected) {
        remoteLog('info', `[net] type changed: ${lastNetType} → ${type}`);
        store()._setNetworkSwitchedAt(Date.now());
        if (switchTimer) clearTimeout(switchTimer);
        switchTimer = setTimeout(checkNow, 800);
      }
      lastNetType = type;
    });
  } catch {
    // HTTP polling still works if native network notifications are unavailable.
  }
  appSub = AppState.addEventListener('change', (state) => {
    if (current() && state === 'active') checkNow();
  });
  pollTimer = setTimeout(() => { pollTimer = null; void check(); }, 3_000);
}

function stopMonitor() {
  running = false;
  monitorGeneration += 1;
  checkGeneration += 1;
  requestAbort?.abort(); requestAbort = null;
  serverUrl = null;
  lastNetType = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
  if (netSub) { netSub.remove(); netSub = null; }
  if (appSub) { appSub.remove(); appSub = null; }
}

export function useConnectionMonitor() {
  const url = useAuthStore((s) => s.serverUrl);
  const mode = useAppMode((s) => s.mode);

  useEffect(() => {
    if (!url || mode !== 'remote') return;
    refCount += 1;
    startMonitor(url); // idempotent; also refreshes serverUrl if it changed

    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        stopMonitor();
      }
    };
  }, [url, mode]);
}
