import { useEffect, useRef } from 'react';
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

export function useConnectionMonitor() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const { status, _setStatus } = useConnectionStore();

  // Set by the polling effect; lets the network-switch listener force an
  // immediate re-ping instead of waiting for the next scheduled poll.
  const checkNowRef = useRef<(() => void) | null>(null);

  // Detect network type switches (e.g. cellular → wifi) and signal them so
  // long-lived resources (audio stream) can recover proactively.
  useEffect(() => {
    const { _setNetworkSwitchedAt, _setIsCellular } = useConnectionStore.getState();
    let lastType: Network.NetworkStateType | null = null;
    let switchCheckTimer: ReturnType<typeof setTimeout>;

    Network.getNetworkStateAsync().then((s) => {
      lastType = s.type ?? null;
      _setIsCellular(s.type === Network.NetworkStateType.CELLULAR);
    });

    const sub = Network.addNetworkStateListener((s) => {
      const currentType = s.type ?? null;
      _setIsCellular(currentType === Network.NetworkStateType.CELLULAR);
      if (lastType !== null && currentType !== lastType) {
        remoteLog('info', `[net] type changed: ${lastType} → ${currentType} (isConnected=${s.isConnected})`);
        if (s.isConnected) {
          _setNetworkSwitchedAt(Date.now());
          // Give the new interface a moment to establish a route, then actively
          // re-ping. We deliberately don't flip status to 'down' here: that only
          // changed the banner text without triggering a poll, so it showed
          // "Server unreachable" until the next scheduled check (up to INTERVAL_OK
          // later) even when the server was reachable on the new network.
          clearTimeout(switchCheckTimer);
          switchCheckTimer = setTimeout(() => checkNowRef.current?.(), 800);
        }
      }
      lastType = currentType;
    });

    return () => { sub.remove(); clearTimeout(switchCheckTimer); };
  }, []);

  // Keep a ref so the async check closure always sees the latest status
  // without needing to be re-created each render.
  const statusRef = useRef<ConnectionStatus>(status);
  statusRef.current = status;

  useEffect(() => {
    if (!serverUrl) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      if (cancelled) return;
      const delay = statusRef.current === 'connected' ? INTERVAL_OK : INTERVAL_DEGRADED;
      timer = setTimeout(check, delay);
    };

    const check = async () => {
      if (cancelled) return;

      const net = await Network.getNetworkStateAsync();
      // isConnected can be null on some Android versions; treat null as "maybe connected"
      if (net.isConnected === false) {
        if (statusRef.current !== 'offline') {
          remoteLog('warn', '[conn] device offline');
        }
        _setStatus('offline');
        schedule();
        return;
      }

      const { ok, latencyMs, error } = await pingServer(serverUrl);
      if (cancelled) return;

      const prev = statusRef.current;
      if (!ok) {
        if (prev !== 'down') remoteLog('warn', `[conn] server unreachable (ping=${latencyMs}ms, ${error})`);
        _setStatus('down', null, error ?? null);
      } else if (latencyMs > SLOW_MS) {
        if (prev !== 'slow') remoteLog('warn', `[conn] server slow (latency=${latencyMs}ms)`);
        else remoteLog('info', `[conn] slow ping=${latencyMs}ms`);
        _setStatus('slow', latencyMs);
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
        _setStatus('connected', latencyMs);
      }

      schedule();
    };

    // Force an immediate ping, cancelling any pending scheduled poll first so the
    // two don't run as overlapping loops. Used by the network-switch listener.
    checkNowRef.current = () => {
      if (cancelled) return;
      clearTimeout(timer);
      check();
    };

    // Short delay on mount so we don't fire immediately on every auth state change
    timer = setTimeout(check, 3_000);

    return () => {
      cancelled = true;
      checkNowRef.current = null;
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);
}
