// <copyright file="usbExport.ts" company="John Narey">
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
import { Directory, File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { MusicTrack } from '../api/musicLibrary';

// Copies on-device local-library tracks to a folder the user picks via the Android Storage
// Access Framework directory picker (e.g. a mounted USB drive) — Android only for now.

const LAST_DIR_KEY = 'usb_export_dir_uri';

export interface UsbExportResult {
  ok: boolean;
  reason?: string;   // error to surface
  message?: string;  // success/info to surface (e.g. "Saved …")
}

export interface UsbExportSummary {
  ok: boolean;
  exported: number;
  skipped: number;
  failed: number;
  reason?: string;
}

type DirectoryResult = { dir: Directory } | { canceled: true } | { error: string };

// Resolves the folder to export into: reuses the last picked SAF tree if it's still valid
// (Android can revoke a persisted grant, e.g. if the drive was unplugged or swapped), otherwise
// prompts the user with the directory picker and persists their choice for next time.
async function getExportDirectory(forcePrompt = false): Promise<DirectoryResult> {
  if (Platform.OS !== 'android') {
    return { error: 'Export to USB is only supported on Android right now.' };
  }

  if (!forcePrompt) {
    const savedUri = await SecureStore.getItemAsync(LAST_DIR_KEY);
    if (savedUri) {
      const dir = new Directory(savedUri);
      if (dir.exists) return { dir };
    }
  }

  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return { canceled: true }; // user dismissed the folder picker — not an error
  }

  await SecureStore.setItemAsync(LAST_DIR_KEY, dir.uri);
  return { dir };
}

function isAlreadyExistsError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /already exists/i.test(msg);
}

/** Copy a single local track into the user-picked USB folder. */
export async function exportTrackToUsb(track: MusicTrack): Promise<UsbExportResult> {
  const dirResult = await getExportDirectory();
  if ('error' in dirResult) return { ok: false, reason: dirResult.error };
  if ('canceled' in dirResult) return { ok: true };

  try {
    const src = new File(track.path);
    await src.copy(dirResult.dir, { overwrite: false });
    return { ok: true, message: `Saved ${track.filename} to the selected folder.` };
  } catch (e) {
    if (isAlreadyExistsError(e)) {
      return { ok: true, message: `${track.filename} is already in the selected folder — skipped.` };
    }
    return { ok: false, reason: `Could not save ${track.filename} — ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

/** Copy many local tracks into a single user-picked USB folder, reporting progress as it goes. */
export async function exportTracksToUsb(
  tracks: MusicTrack[],
  onProgress?: (done: number, total: number) => void,
): Promise<UsbExportSummary> {
  const dirResult = await getExportDirectory();
  if ('error' in dirResult) return { ok: false, exported: 0, skipped: 0, failed: 0, reason: dirResult.error };
  if ('canceled' in dirResult) return { ok: true, exported: 0, skipped: 0, failed: 0 };

  let exported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    try {
      const src = new File(track.path);
      await src.copy(dirResult.dir, { overwrite: false });
      exported++;
    } catch (e) {
      if (isAlreadyExistsError(e)) skipped++;
      else failed++;
    }
    onProgress?.(i + 1, tracks.length);
  }

  return { ok: true, exported, skipped, failed };
}
