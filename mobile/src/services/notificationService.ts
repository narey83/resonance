// <copyright file="notificationService.ts" company="John Narey">
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

/**
 * Local notification service for Resonance events.
 *
 * Requires `expo-notifications` — if not yet installed, run:
 *   npx expo install expo-notifications
 * then rebuild the dev client.
 */

import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { HubConnectionState } from '@microsoft/signalr';
import { useAppSettings } from '../store/appSettingsStore';
import { useAuthStore, getDeviceId } from '../store/auth';
import { createApplicationHubConnection } from '../api/applicationHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';
import { registerPushToken } from '../api/pushTokens';
import { useConversationStore } from '../store/conversationStore';
import { useRoomStore } from '../store/roomStore';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import type { BlockedUsersPayload } from '../api/blockedUsers';

let notificationsModule: typeof import('expo-notifications') | null = null;

async function getModule() {
  if (notificationsModule) return notificationsModule;
  // expo-notifications accesses native modules at load time — only import if
  // the native side is actually present (requires a custom dev build).
  // Probe via requireOptionalNativeModule, not RN's `NativeModules`: Expo
  // modules register on globalThis.expo.modules and never appear on the legacy
  // bridge registry, so a NativeModules lookup is always undefined and silently
  // disables every notification.
  if (!requireOptionalNativeModule('ExpoNotificationScheduler')) return null;
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

export async function notifyPrivateMessage(username: string, message: string) {
  const { notifications } = useAppSettings.getState();
  if (!notifications.privateMessage) return;
  await send(`Message from ${username}`, message);
}

export async function notifyRoomMention(roomName: string, username: string, message: string) {
  const { notifications } = useAppSettings.getState();
  if (!notifications.roomMention) return;
  await send(`Mentioned in ${roomName}`, `${username}: ${message}`);
}

// Administrators only -- the backend's FCM push is already filtered to admin accounts, and the
// hub path below is gated on isAdmin, so a non-admin never reaches this.
export async function notifyRestartRequired() {
  const { notifications } = useAppSettings.getState();
  if (!notifications.restartRequired) return;
  await send('Restart required', 'A configuration change needs a backend restart to take effect.');
}

export async function notifyUserBlocked(username: string, ip: string) {
  const { notifications } = useAppSettings.getState();
  if (!notifications.userBlocked) return;
  await send('Ban evasion blocked', `"${username}" was auto-blocked — same IP (${ip}) as a blocked user.`);
}

// Hook — mount once at the top of the authenticated app to register this device's FCM push
// token with the backend, so a library change can reach it via a background push even while
// the app is backgrounded or killed (the SignalR hub in libraryActivityStore only reaches a
// live, connected app). Re-registers on token rotation (device re-registration, app reinstall).
export const usePushNotifications = () => {
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    const register = async (token: string) => {
      try {
        const deviceId = await getDeviceId();
        await registerPushToken(token, deviceId, Platform.OS);
      } catch {}
    };

    (async () => {
      const N = await getModule();
      if (!N || cancelled) return;

      try {
        const { data } = await N.getDevicePushTokenAsync();
        if (!cancelled) await register(data);
      } catch {}

      if (cancelled) return;
      subscription = N.addPushTokenListener((newToken) => { register(newToken.data); });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
};

// Hook — mount once at the top of the authenticated app to trigger native notifications
export const useNotificationHub = () => {
  useEffect(() => {
    const hub = createApplicationHubConnection();
    if (!hub) return;

    let prevScanning: boolean | null = null;
    let prevPendingRestart: boolean | null = null;

    attachHubLogging(hub, 'application');

    hub.on('OPTIONS', () => {});

    // Re-fetch conversations on any incoming private message so all logged-in
    // sessions stay in sync (messages sent from the web will appear here too).
    // Also refresh the thread itself if it's already loaded, otherwise a
    // conversation open on screen never sees the new message until reopened.
    hub.on('PRIVATE_MESSAGE', ({ username, message }: { username: string; message: string }) => {
      useConversationStore.getState().loadConversations();
      if (username in useConversationStore.getState().messages) {
        useConversationStore.getState().loadMessages(username);
      }
      notifyPrivateMessage(username, message);
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

    hub.on('STATE', (state: { shares?: { scanning?: boolean }; pendingRestart?: boolean }) => {
      const scanning = state?.shares?.scanning ?? false;

      if (prevScanning === true && !scanning) {
        notifyShareScanComplete();
      }

      prevScanning = scanning;

      // Only the false -> true edge, and only for admins (the restart endpoint refuses
      // everyone else). prevPendingRestart starts null so the first STATE after connecting
      // seeds it without notifying -- otherwise reopening the app with a restart already
      // outstanding would alert every time.
      const pendingRestart = state?.pendingRestart ?? false;

      if (prevPendingRestart === false && pendingRestart && useAuthStore.getState().isAdmin) {
        notifyRestartRequired();
      }

      prevPendingRestart = pendingRestart;
    });

    hub.on('BROWSED', () => {});
    hub.on('BLOCKED_USERS', (payload: BlockedUsersPayload) => {
      useBlockedUsersStore.getState().apply(payload);
    });
    hub.on('BLOCKED_USER_ALERT', ({ username, ip }: { username: string; ip: string }) => {
      notifyUserBlocked(username, ip);
    });
    hub.on('ROOM_MENTION', ({ roomName, username, message }: { roomName: string; username: string; message: string }) => {
      useRoomStore.getState().noteMention(roomName);
      // Keep an open room thread current — rooms have no per-message hub push,
      // so a mention is the one chance to refresh without waiting for a poll.
      if (roomName in useRoomStore.getState().messages) {
        useRoomStore.getState().loadMessages(roomName).catch(() => {});
      }
      notifyRoomMention(roomName, username, message);
    });

    // Messages that arrived while the app was closed only reach the tab badge
    // via a fetch — the hub replays nothing on connect.
    useConversationStore.getState().loadConversations();

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
