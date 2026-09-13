// <copyright file="appUpdate.ts" company="John Narey">
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

import { Platform } from 'react-native';
import * as LegacyFS from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { getValidToken } from '../api/client';
import { useAuthStore } from '../store/auth';

// FLAG_GRANT_READ_URI_PERMISSION: the installer is a different app, and without this the
// content:// URI it is handed resolves to nothing it is allowed to read.
const FLAG_GRANT_READ_URI_PERMISSION = 1;

const APK_MIME = 'application/vnd.android.package-archive';

export type UpdateProgress = (fraction: number) => void;

export interface UpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * Downloads the APK attached to the latest release and hands it to Android's package installer.
 *
 * The download goes through this app's own server rather than GitHub: the repository is private,
 * so the asset needs a token, and the server is the one that has it. That also means the download
 * is authenticated as this user with the session they already have.
 *
 * Installing is the system's decision, not ours -- this opens the installer and the user confirms
 * there. Nothing is installed silently, and a sideloaded build cannot replace itself unattended.
 */
export const downloadAndInstallUpdate = async (
  version: string,
  onProgress?: UpdateProgress,
): Promise<UpdateResult> => {
  if (Platform.OS !== 'android') {
    return { ok: false, error: 'Updates can only be installed on Android.' };
  }

  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return { ok: false, error: 'Not connected to a server.' };

  const token = await getValidToken();
  if (!token) return { ok: false, error: 'Session expired — sign in again.' };

  // Cache, not documents: this is a large file with no reason to survive the install, and the
  // system clears it if the device gets tight on space.
  const target = `${LegacyFS.cacheDirectory}resonance-${version}.apk`;

  try {
    // A stale partial from an interrupted attempt would otherwise be resumed as if it were whole.
    await LegacyFS.deleteAsync(target, { idempotent: true });

    const download = LegacyFS.createDownloadResumable(
      `${serverUrl}/api/v0/application/update/apk`,
      target,
      { headers: { Authorization: `Bearer ${token}` } },
      onProgress
        ? ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
            if (totalBytesExpectedToWrite > 0) {
              onProgress(totalBytesWritten / totalBytesExpectedToWrite);
            }
          }
        : undefined,
    );

    const result = await download.downloadAsync();

    if (!result || result.status !== 200) {
      return { ok: false, error: `Download failed (HTTP ${result?.status ?? 'no response'}).` };
    }

    // The installer is another app and cannot read a file:// path in this app's sandbox; the
    // FileProvider expo-file-system registers turns it into something it can open.
    const contentUri = await LegacyFS.getContentUriAsync(result.uri);

    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      type: APK_MIME,
    });

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
