import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
  RetryContext,
} from '@microsoft/signalr';
import { useAuthStore } from '../store/auth';
import { getValidToken } from './client';

const infiniteRetryPolicy = {
  nextRetryDelayInMilliseconds: (context: RetryContext) => {
    if (context.elapsedMilliseconds < 10_000) return Math.min(2 ** context.previousRetryCount * 500, 5_000);
    return 30_000;
  },
};

export const createApplicationHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;

  return new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/application`, {
      accessTokenFactory: () => getValidToken(),
    })
    .withAutomaticReconnect(infiniteRetryPolicy)
    .withServerTimeout(120_000)
    .withKeepAliveInterval(15_000)
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(LogLevel.Information)
    .build();
};
