import { hubBaseUrl } from '../config';
import { attemptRefresh } from './api';
import {
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getToken,
  isPassthroughEnabled,
} from './token';
import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
} from '@microsoft/signalr';

const getValidToken = async () => {
  const token = getToken();
  if (!token) return token;

  let payload = null;
  try {
    payload = JSON.parse(atob(token.split('.')[1]));
  } catch {
    /* ignore */
  }

  if (payload) {
    const isStaleOrSoon = payload.exp * 1_000 < Date.now() + 60_000;
    if (isStaleOrSoon && getRefreshToken()) {
      try {
        await attemptRefresh();
      } catch (error) {
        if (error.response?.status === 401) {
          clearToken();
          clearRefreshToken();
          clearSessionId();
          window.location.reload(true);
          return null;
        }
      }
    }
  }

  return getToken();
};

const createInfiniteRetryPolicy = (onRetry) => ({
  nextRetryDelayInMilliseconds: (context) => {
    onRetry?.(context);
    if (context.elapsedMilliseconds < 10_000)
      return Math.min(2 ** context.previousRetryCount * 500, 5_000);
    return 30_000;
  },
});

export const createHubConnection = ({ onRetry, url }) => {
  const connection = new HubConnectionBuilder()
    .withUrl(url, {
      accessTokenFactory: isPassthroughEnabled() ? undefined : getValidToken,
      withCredentials: true,
    })
    .withAutomaticReconnect(createInfiniteRetryPolicy(onRetry))
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(LogLevel.Error)
    .build();
  connection.serverTimeoutInMilliseconds = 120_000;
  return connection;
};

export const createApplicationHubConnection = ({ onRetry } = {}) =>
  createHubConnection({ onRetry, url: `${hubBaseUrl}/application` });

export const createLogsHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/logs` });

export const createSearchHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/search` });

export const createMixtapesHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/mixtapes` });

export const createLibraryActivityHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/libraryactivity` });

export const createYtDlpHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/ytdlp` });
