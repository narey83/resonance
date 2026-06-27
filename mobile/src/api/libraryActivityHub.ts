import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
} from '@microsoft/signalr';
import { useAuthStore } from '../store/auth';
import { getValidToken } from './client';

export const LIBRARY_ACTIVITY_SNAPSHOT        = 'SNAPSHOT';
export const LIBRARY_ACTIVITY_LOVED           = 'TRACK_LOVED';
export const LIBRARY_ACTIVITY_UNLOVED         = 'TRACK_UNLOVED';
export const LIBRARY_ACTIVITY_ALL_UNLOVED     = 'ALL_UNLOVED';
export const LIBRARY_ACTIVITY_PLAYED          = 'TRACK_PLAYED';
export const LIBRARY_ACTIVITY_PLAY_DELETED    = 'PLAY_DELETED';
export const LIBRARY_ACTIVITY_HISTORY_CLEARED = 'HISTORY_CLEARED';
export const LIBRARY_ACTIVITY_LIBRARY_UPDATED = 'LIBRARY_UPDATED';
export const LIBRARY_ACTIVITY_SYNC_STATE      = 'SYNC_STATE';

export const createLibraryActivityHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;

  return new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/libraryactivity`, {
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
