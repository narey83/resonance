import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
} from '@microsoft/signalr';
import { useAuthStore } from '../store/auth';
import { getValidToken } from './client';

export const createSearchHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;

  return new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/search`, {
      accessTokenFactory: () => getValidToken(),
    })
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (context) =>
        context.elapsedMilliseconds < 10_000
          ? Math.min(2 ** context.previousRetryCount * 500, 5_000)
          : 30_000,
    })
    .withServerTimeout(120_000)
    .withKeepAliveInterval(15_000)
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(LogLevel.Information)
    .build();
};
