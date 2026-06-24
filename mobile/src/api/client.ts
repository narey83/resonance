import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth';
import { useNetworkLog } from '../store/networkLogStore';

// Stamp the request start time onto the config so the response/error interceptors
// can compute latency. Augments axios's config type rather than casting at each use.
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { startedAt: number };
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
    out[k] = k.toLowerCase() === 'authorization' ? 'Bearer […]' : String(v);
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
    url:             config?.url ?? '(unknown)',
    status,
    ok:              status !== null && status >= 200 && status < 400,
    durationMs:      Date.now() - startedAt,
    startedAt,
    error:           opts.error ? errorLabel(opts.error) : undefined,
    fullUrl:         config ? `${config.baseURL ?? ''}${config.url ?? ''}` : undefined,
    requestHeaders:  headerObject(config?.headers),
    responseHeaders: headerObject(opts.responseHeaders),
  });
}

const getJwtExpiry = (token: string): number | null => {
  try {
    return (JSON.parse(atob(token.split('.')[1])) as { exp?: number }).exp ?? null;
  } catch {
    return null;
  }
};

// Single shared refresh promise — used by both getValidToken (proactive) and the HTTP interceptor
// (reactive). Prevents two concurrent callers from each sending a refresh request with the same
// (already-about-to-be-rotated) refresh token; the second would always get a 401.
let pendingRefresh: Promise<string | null> | null = null;

const doRefresh = (): Promise<string | null> => {
  if (pendingRefresh) return pendingRefresh;

  const { refreshToken, serverUrl, setTokens, clearTokens } = useAuthStore.getState();
  if (!refreshToken || !serverUrl) return Promise.resolve(null);

  pendingRefresh = axios
    .post(`${serverUrl}/api/v0/session/refresh`, { refreshToken }, { timeout: 10_000 })
    .then(async ({ data }) => {
      await setTokens(data.token, data.refreshToken, data.sessionId);
      return data.token as string;
    })
    .catch(async (err: unknown) => {
      const status = (err as AxiosError)?.response?.status;
      if (status === 401 || status === 403) {
        await clearTokens();
      }
      return null;
    })
    .finally(() => { pendingRefresh = null; });

  return pendingRefresh;
};

/**
 * Returns a valid access token, proactively refreshing it if it expires within 60 s.
 * Used by SignalR accessTokenFactory so hubs can reconnect after token expiry without a 401.
 */
export const getValidToken = async (): Promise<string> => {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return '';

  const exp = getJwtExpiry(accessToken);
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

// Attach the base URL and bearer token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { serverUrl, accessToken } = useAuthStore.getState();
  if (serverUrl) config.baseURL = `${serverUrl}/api/v0`;
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  config.metadata = { startedAt: Date.now() };
  return config;
});

// Record every request's latency and outcome into the in-memory network log (debug screen).
// Registered BEFORE the 401-retry interceptor so it logs the original 401 as well as the
// replayed request (the retry runs through the whole interceptor chain again).
apiClient.interceptors.response.use(
  (response) => {
    recordNetwork(response.config, response.status, { responseHeaders: response.headers });
    return response;
  },
  (error: AxiosError) => {
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

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    original._retry = true;

    const newToken = await doRefresh();
    if (!newToken) {
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return apiClient(original);
  },
);
