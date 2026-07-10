// <copyright file="usbExport.js" company="John Narey">
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

import { getLocalStreamUrl } from './files';
import { ensureSigned } from './streamSignatures';

// Copies library tracks to a folder the user picks via the browser's File System Access API
// (e.g. a mounted USB drive). Chrome/Edge only — Firefox and Safari don't implement it, so
// callers should gate the UI on isUsbExportSupported() rather than surfacing an error.

const DB_NAME = 'resonance-usb-export';
const STORE_NAME = 'handles';
const DIR_KEY = 'dir';

export const isUsbExportSupported = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const openDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });

const getSavedDirHandle = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(DIR_KEY);
    request.addEventListener('success', () => resolve(request.result ?? null));
    request.addEventListener('error', () => reject(request.error));
  });
};

const saveDirHandle = async (handle) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, DIR_KEY);
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error));
  });
};

// Resolves the folder to export into: reuses the last picked directory if permission is still
// granted, otherwise prompts the user with the directory picker and persists their choice.
const getExportDirectory = async (forcePrompt = false) => {
  if (!isUsbExportSupported()) {
    return {
      error: 'Export to USB needs a Chromium-based browser (Chrome/Edge).',
    };
  }

  if (!forcePrompt) {
    try {
      const saved = await getSavedDirHandle();
      if (saved) {
        const permission = await saved.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') return { dir: saved };
        if (permission === 'prompt') {
          const requested = await saved.requestPermission({
            mode: 'readwrite',
          });
          if (requested === 'granted') return { dir: saved };
        }
      }
    } catch {
      /* fall through to the picker */
    }
  }

  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return { canceled: true }; // user dismissed the folder picker — not an error
  }

  await saveDirHandle(dir).catch(() => {});
  return { dir };
};

// A same-named file with a matching size is treated as already exported.
const isAlreadyExported = async (dir, filename, expectedSize) => {
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return expectedSize == null || file.size === expectedSize;
  } catch {
    return false;
  }
};

const copyTrackInto = async (dir, track) => {
  await ensureSigned([track.path]);
  const response = await fetch(getLocalStreamUrl(track.path));
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const expectedSize = contentLength ? Number(contentLength) : null;
  if (await isAlreadyExported(dir, track.filename, expectedSize)) {
    return 'skipped';
  }

  const fileHandle = await dir.getFileHandle(track.filename, { create: true });
  const writable = await fileHandle.createWritable();
  if (response.body && typeof response.body.pipeTo === 'function') {
    await response.body.pipeTo(writable);
  } else {
    await writable.write(await response.blob());
    await writable.close();
  }

  return 'exported';
};

/**
 * Copy a single library track into the user-picked USB folder.
 */
export const exportTrackToUsb = async (track) => {
  const dirResult = await getExportDirectory();
  if ('error' in dirResult) return { ok: false, reason: dirResult.error };
  if ('canceled' in dirResult) return { ok: true };

  try {
    const outcome = await copyTrackInto(dirResult.dir, track);
    return {
      ok: true,
      message:
        outcome === 'skipped'
          ? `${track.filename} is already in the selected folder — skipped.`
          : `Saved ${track.filename} to the selected folder.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Could not save ${track.filename} — ${error?.message ?? 'unknown error'}`,
    };
  }
};

/**
 * Copy many library tracks into a single user-picked USB folder, reporting progress as it goes.
 */
export const exportTracksToUsb = async (tracks, onProgress) => {
  const dirResult = await getExportDirectory();
  if ('error' in dirResult)
    return {
      ok: false,
      exported: 0,
      skipped: 0,
      failed: 0,
      reason: dirResult.error,
    };
  if ('canceled' in dirResult)
    return { ok: true, exported: 0, skipped: 0, failed: 0 };

  let exported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < tracks.length; i++) {
    try {
      const outcome = await copyTrackInto(dirResult.dir, tracks[i]);
      if (outcome === 'skipped') skipped++;
      else exported++;
    } catch {
      failed++;
    }

    onProgress?.(i + 1, tracks.length);
  }

  return { ok: true, exported, skipped, failed };
};
