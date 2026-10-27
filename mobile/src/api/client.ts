// <copyright file="client.ts" company="John Narey">
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

import { redactDiagnostics } from '../lib/redact';
import axios, { CanceledError, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAppMode } from '../store/appModeStore';
import { useAuthStore } from '../store/auth';
import { useNetworkLog } from '../store/networkLogStore';
import { decodeJwt } from '../lib/jwt';
import { getSessionGeneration, isCurrentSession } from '../lib/sessionScope';

// Stamp the request start time onto the config so the response/error interceptors
// can compute latency. Augments axios's config type rather than casting at each use.
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { startedAt: number; generation: number };
  }
}

// axios's default export legitimately exposes `.create` — false positive here.
// eslint-disable-next-line import/no-named-as-default-member
export const apiClient = axios.create({ timeout: 15000 });

// Human-readable label for a failed request, mirroring connectionMonitor's categorisation:
// an HTTP status means we reached the server; a timeout / bare code means we never got a response.
function errorLabel(err: AxiosError): string {
  if (err.response) return `HTTP ${err.response.status}`;
  if (err.code === 'ECONNABORTED') return 'timeout';
  return err.code ?? err.message ?? 'network error';
}

// Flatten axios headers to a plain string map for the debug detail view, redacting the
// bearer token so the log never exposes a usable credential.
function headerObject(h: unknown): Record<string, string> | undefined {
  if (!h || typeof h !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (v == null || typeof v === 'object' || typeof v === 'function') continue;
    out[k] = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-resonance-link-token)$/i.test(k) ? '[redacted]' : redactDiagnostics(String(v));
  }
  return Object.keys(out).length ? out : undefined;
}

function recordNetwork(
  config: InternalAxiosRequestConfig | undefined,
  status: number | null,
  opts: { error?: AxiosError; responseHeaders?: unknown } = {},
) {
  const startedAt = config?.metadata?.startedAt ?? Date.now();
  useNetworkLog.getState().record({
    kind:            'http',
    method:          (config?.method ?? 'get').toUpperCase(),
    url:             redactDiagnostics(config?.url ?? '(unknown)'),
    status,
    ok:              status !== null && status >= 200 && status < 400,
    durationMs:      Date.now() - startedAt,
    startedAt,
    error:           opts.error ? errorLabel(opts.error) : undefined,
    fullUrl:         config ? redactDiagnostics(`${config.baseURL ?? ''}${config.url ?? ''}`) : undefined,
    requestHeaders:  headerObject(config?.headers),
    responseHeaders: headerObject(opts.responseHeaders),
  });
}

// Refreshes are shared only within the login that started them.
let pendingRefresh: { generation: number; promise: Promise<string | null> } | null = null;

const doRefresh = (): Promise<string | null> => {
  if (useAppMode.getState().mode !== 'remote') return Promise.resolve(null);
  const generation = getSessionGeneration();
  if (pendingRefresh?.generation === generation) return pendingRefresh.promise;

  const { refreshToken, serverUrl, setTokens, clearTokens } = useAuthStore.getState();
  if (!refreshToken || !serverUrl) return Promise.resolve(null);
  const stillCurrent = () => isCurrentSession(generation) &&
    useAuthStore.getState().refreshToken === refreshToken;

  const promise = axios
    .post(`${serverUrl}/api/v0/session/refresh`, { refreshToken }, { timeout: 10_000 })
    .then(async ({ data }) => {
      if (!stillCurrent()) return null;
      await setTokens(data.token, data.refreshToken, data.sessionId, { generation, refresh: true });
      return isCurrentSession(generation) ? data.token as string : null;
    })
    .catch(async (err: unknown) => {
      const status = (err as AxiosError)?.response?.status;
      if (stillCurrent() && (status === 401 || status === 403)) {
        await clearTokens().catch(() => {});
      }
      return null;
    })
    .finally(() => {
      if (pendingRefresh?.promise === promise) pendingRefresh = null;
    });
  pendingRefresh = { generation, promise };
  return promise;
};

/**
 * Returns a valid access token, proactively refreshing it if it expires within 60 s.
 * Used by SignalR accessTokenFactory so hubs can reconnect after token expiry without a 401.
 */
export const getValidToken = async (): Promise<string> => {
  if (useAppMode.getState().mode !== 'remote') return '';
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return '';

  const exp = decodeJwt(accessToken)?.exp ?? null;
  const isStaleOrSoon = exp !== null && exp * 1000 < Date.now() + 60_000;
  if (!isStaleOrSoon) return accessToken;

  // Truly expired with no refresh token — clear and force login immediately.
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    if (exp !== null && exp * 1000 < Date.now()) {
      await useAuthStore.getState().clearTokens();
      return '';
    }
    return accessToken;
  }

  const newToken = await doRefresh();
  return newToken ?? '';
};

/** A hub keeps its original server URL; never give it a subsequent login's token. */
export const createAccessTokenFactory = (): (() => Promise<string>) => {
  const generation = getSessionGeneration();
  return async () => {
    if (!isCurrentSession(generation)) return '';
    const token = await getValidToken();
    return isCurrentSession(generation) ? token : '';
  };
};

// Attach the base URL and bearer token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { serverUrl, accessToken } = useAuthStore.getState();
  if (config.metadata && !isCurrentSession(config.metadata.generation)) {
    throw new CanceledError('Session changed');
  }
  if (useAppMode.getState().mode !== 'remote' || !serverUrl || !accessToken) throw new CanceledError('Remote server access is disabled');
  if (serverUrl) config.baseURL = `${serverUrl}/api/v0`;
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  config.metadata = { startedAt: Date.now(), generation: getSessionGeneration() };
  return config;
}, (error: unknown) => { throw error; }, { synchronous: true });

// Record every request's latency and outcome into the in-memory network log (debug screen).
// Registered BEFORE the 401-retry interceptor so it logs the original 401 as well as the
// replayed request (the retry runs through the whole interceptor chain again).
apiClient.interceptors.response.use(
  (response) => {
    if (!response.config.metadata || !isCurrentSession(response.config.metadata.generation)) {
      throw new CanceledError('Session changed');
    }
    recordNetwork(response.config, response.status, { responseHeaders: response.headers });
    return response;
  },
  (error: AxiosError) => {
    if (error.config?.metadata && !isCurrentSession(error.config.metadata.generation)) {
      return Promise.reject(new CanceledError('Session changed'));
    }
    recordNetwork(error.config, error.response?.status ?? null, {
      error,
      responseHeaders: error.response?.headers,
    });
    return Promise.reject(error);
  },
);

// On 401, silently refresh the access token and replay the request once.
// Uses the same pendingRefresh as getValidToken so concurrent hub+API refreshes
// don't double-fire and invalidate each other's tokens.
apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (!original || error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    original._retry = true;

    const newToken = await doRefresh();
    if (!newToken || !original.metadata || !isCurrentSession(original.metadata.generation)) {
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return apiClient(original);
  },
);
