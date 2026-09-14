// <copyright file="backgroundPushTask.ts" company="John Narey">
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
 * Handles the "library updated" FCM push while the app is backgrounded or fully killed, by
 * re-syncing the on-device library cache in the background — so by the time the user opens the
 * app, the cold-start sync (see librarySyncStore) finds nothing new to do.
 *
 * Best-effort only: Android Doze mode and iOS background execution limits mean this task isn't
 * guaranteed to run. The foreground cold-start sync is the reliable fallback either way.
 *
 * Must be defined and registered at module scope, imported early (from index.ts) — expo-task-manager
 * needs the task defined before the JS bundle finishes loading, including when the app is launched
 * solely to handle a push while otherwise killed.
 */

const BACKGROUND_PUSH_TASK = 'resonance-background-push';

export function registerBackgroundPushTask() {
  (async () => {
    try {
      const TaskManager = await import('expo-task-manager');
      const Notifications = await import('expo-notifications');

      TaskManager.defineTask(BACKGROUND_PUSH_TASK, async ({ data, error }) => {
        if (error) return;

        // Android hands the task the raw FCM RemoteMessage, so the data-only key/value pairs
        // the backend sent sit under `data.data`. Fall back to the top level in case the
        // platform (or a future expo-notifications) flattens it.
        const payload = (data as { data?: Record<string, string> } | undefined);
        const type = payload?.data?.type ?? (data as { type?: string } | undefined)?.type;

        // Older backends send no discriminator at all; treat that as the library push it
        // used to be, so a mixed-version pair keeps syncing.
        if (type === 'restart_required') {
          try {
            const { notifyRestartRequired } = await import('./notificationService');
            await notifyRestartRequired();
          } catch {}
          return;
        }

        try {
          const { useLibrarySync } = await import('../store/librarySyncStore');
          // `force: true` bypasses the in-session/rate-limit/version gates — a push only ever
          // fires on a real backend change, so there's nothing to gate here.
          await useLibrarySync.getState().sync(Date.now(), true);
        } catch {}
      });

      await Notifications.registerTaskAsync(BACKGROUND_PUSH_TASK);
    } catch {
      // expo-notifications/expo-task-manager's native side isn't present (e.g. before the dev
      // client has been rebuilt with the FCM config) — background push silently unavailable,
      // same as the rest of notificationService's defensive module probing.
    }
  })();
}
