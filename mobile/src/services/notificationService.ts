/**
 * Local notification service for Resonance events.
 *
 * Requires `expo-notifications` — if not yet installed, run:
 *   npx expo install expo-notifications
 * then rebuild the dev client.
 */

import { useEffect } from 'react';
import { AppState, NativeModules } from 'react-native';
import { HubConnectionState } from '@microsoft/signalr';
import { useAppSettings } from '../store/appSettingsStore';
import { useAuthStore } from '../store/auth';
import { createApplicationHubConnection } from '../api/applicationHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';
import { useConversationStore } from '../store/conversationStore';

let notificationsModule: typeof import('expo-notifications') | null = null;

async function getModule() {
  if (notificationsModule) return notificationsModule;
  // expo-notifications accesses native modules at load time — only import
  // if the native module is present (requires a custom dev build).
  if (!NativeModules.ExpoPushTokenManager) return null;
  try {
    notificationsModule = await import('expo-notifications');
    return notificationsModule;
  } catch {
    return null;
  }
}

export async function initNotifications(): Promise<boolean> {
  const N = await getModule();
  if (!N) return false;

  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge:  false,
        shouldShowBanner: true,
        shouldShowList:   true,
      }),
    });

    const { status: existing } = await N.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await N.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

async function send(title: string, body: string) {
  const N = await getModule();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {}
}

export async function notifyDownloadComplete(filename: string) {
  const { notifications } = useAppSettings.getState();
  if (!notifications.downloadsComplete) return;
  await send('Download complete', filename);
}

export async function notifyUploadComplete(filename: string) {
  const { notifications } = useAppSettings.getState();
  if (!notifications.uploadComplete) return;
  await send('Upload complete', filename);
}

export async function notifyShareScanComplete() {
  const { notifications } = useAppSettings.getState();
  if (!notifications.shareScanComplete) return;
  await send('Share scan complete', 'Your library index has been updated.');
}

export async function notifyServerDisconnect() {
  const { notifications } = useAppSettings.getState();
  if (!notifications.serverDisconnect) return;
  await send('Server disconnected', 'Resonance lost its connection to the Soulseek network.');
}

export async function notifyServerRestarting() {
  const { notifications } = useAppSettings.getState();
  if (!notifications.serverDisconnect) return;
  await send('Server restarting', 'Resonance backend is restarting. It will reconnect automatically.');
}

export async function notifyServerReady() {
  const { notifications } = useAppSettings.getState();
  if (!notifications.serverDisconnect) return;
  await send('Server ready', 'Resonance backend is back online.');
}

// Hook — mount once at the top of the authenticated app to trigger native notifications
export const useNotificationHub = () => {
  useEffect(() => {
    const hub = createApplicationHubConnection();
    if (!hub) return;

    let prevConnected: boolean | null = null;
    let prevScanning: boolean | null = null;

    attachHubLogging(hub, 'application');

    hub.on('OPTIONS', () => {});

    // Re-fetch conversations on any incoming private message so all logged-in
    // sessions stay in sync (messages sent from the web will appear here too).
    hub.on('PRIVATE_MESSAGE', () => {
      useConversationStore.getState().loadConversations();
    });

    hub.on('SESSION_REVOKED', (revokedIds: string[]) => {
      const { sessionId, clearTokens } = useAuthStore.getState();
      if (sessionId && revokedIds.includes(sessionId)) {
        clearTokens();
      }
    });

    hub.on('DOWNLOAD_DIRECTORY_COMPLETE', ({ directoryName }: { directoryName: string }) => {
      notifyDownloadComplete(directoryName);
    });

    hub.on('UPLOAD_FILE_COMPLETE', ({ filename }: { filename: string }) => {
      notifyUploadComplete(filename);
    });

    hub.on('STATE', (state: { server?: { isConnected?: boolean }; shares?: { scanning?: boolean } }) => {
      const connected = state?.server?.isConnected ?? false;
      const scanning  = state?.shares?.scanning  ?? false;

      if (prevConnected === true && !connected) {
        notifyServerDisconnect();
      }
      if (prevScanning === true && !scanning) {
        notifyShareScanComplete();
      }

      prevConnected = connected;
      prevScanning  = scanning;
    });

    hub.on('SERVER_RESTARTING', () => {
      notifyServerRestarting();
    });

    hub.on('SERVER_READY', () => {
      notifyServerReady();
    });

    hub.on('BROWSED',      () => {});
    hub.on('ROOM_MENTION', () => {});

    hub.onreconnected(() => {
      notifyServerReady();
    });

    const startPromise = hub.start().catch((err: unknown) => {
      remoteLog('error', `[hub:application] start failed — ${err instanceof Error ? err.message : String(err)}`);
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hub.state === HubConnectionState.Disconnected) {
        hub.start().catch(() => {});
      }
    });

    return () => {
      appStateSub.remove();
      startPromise.then(() => hub.stop().catch(() => {}));
    };
  }, []);
};
