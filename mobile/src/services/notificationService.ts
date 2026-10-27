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

import { startMessagingSync } from './messagingSync';
import { maintainServerConnection } from '../lib/serverConnection';
import { getApplicationState } from '../api/application';
import { sessionGuard } from '../lib/sessionScope';
import { useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { useAppSettings } from '../store/appSettingsStore';
import { useAuthStore } from '../store/auth';
import { createApplicationHubConnection } from '../api/applicationHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';
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

// Restart alerts are only shown to administrators.
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

// Hook — mount once at the top of the authenticated app to trigger native notifications
export const useNotificationHub = () => {
  useEffect(() => {
    const current = sessionGuard();
    const hub = createApplicationHubConnection();
    if (!hub) return;

    let prevScanning: boolean | null = null;
    let prevPendingRestart: boolean | null = null;

    attachHubLogging(hub, 'application');

    hub.on('OPTIONS', () => {});

    const messaging = startMessagingSync(hub, current);
    hub.on('PRIVATE_MESSAGE', ({ username, message }: { username: string; message: string }) => {
      if (!current()) return;
      notifyPrivateMessage(username, message);
    });

    hub.on('SESSION_REVOKED', (revokedIds: string[]) => {
      if (!current()) return;
      const { sessionId, clearTokens } = useAuthStore.getState();
      if (sessionId && revokedIds.includes(sessionId)) {
        void clearTokens().catch(() => {});
      }
    });

    hub.on('DOWNLOAD_DIRECTORY_COMPLETE', ({ directoryName }: { directoryName: string }) => {
      if (!current()) return;
      notifyDownloadComplete(directoryName);
    });

    hub.on('UPLOAD_FILE_COMPLETE', ({ filename }: { filename: string }) => {
      if (!current()) return;
      notifyUploadComplete(filename);
    });

    const applyState = (state: { shares?: { scanning?: boolean }; pendingRestart?: boolean }) => {
      if (!current()) return;
      const scanning = state?.shares?.scanning ?? false;

      if (prevScanning === true && !scanning) {
        notifyShareScanComplete();
      }

      prevScanning = scanning;

      // Include an outstanding restart on connection/resume, since it may have happened
      // while disconnected. Suppress duplicates for the rest of this login.
      const pendingRestart = state?.pendingRestart ?? false;

      if (prevPendingRestart !== true && pendingRestart && useAuthStore.getState().isAdmin) {
        notifyRestartRequired();
      }

      prevPendingRestart = pendingRestart;
    };
    hub.on('STATE', applyState);

    hub.on('BROWSED', () => {});
    hub.on('BLOCKED_USERS', (payload: BlockedUsersPayload) => {
      if (!current()) return;
      useBlockedUsersStore.getState().apply(payload);
    });
    hub.on('BLOCKED_USER_ALERT', ({ username, ip }: { username: string; ip: string }) => {
      if (!current()) return;
      notifyUserBlocked(username, ip);
    });
    hub.on('ROOM_MENTION', ({ roomName, username, message }: { roomName: string; username: string; message: string }) => {
      if (!current()) return;
      useRoomStore.getState().noteMention(roomName);
      notifyRoomMention(roomName, username, message);
    });

    // Messages that arrived while the app was closed only reach the tab badge
    // via a fetch — the hub replays nothing on connect.
    messaging.reconcile();

    const stopConnection = maintainServerConnection(hub, current, () => {
      messaging.reconcile();
      // Refresh even if SignalR still considers its suspended connection healthy.
      void getApplicationState().then(applyState).catch(() => {});
    }, (err) => {
      remoteLog('error', `[hub:application] start failed — ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => { messaging.stop(); stopConnection(); };
  }, []);
};
