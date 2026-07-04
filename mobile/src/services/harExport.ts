// <copyright file="harExport.ts" company="John Narey">
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
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { NetworkLogEntry } from '../store/networkLogStore';

// Exports the captured network log as a HAR 1.2 (HTTP Archive) file and opens the OS share
// sheet. HAR is the standard format that latency-analysis tools consume directly:
//   • Google HAR Analyzer — https://toolbox.googleapps.com/apps/har_analyzer/
//   • Chrome DevTools → Network → "Import HAR"
//   • Charles / Proxyman / Firefox
// Spec: http://www.softwareishard.com/blog/har-12-spec/

const CREATOR = { name: 'Resonance Mobile Network Log', version: '1.0.0' };

type HarNameValue = { name: string; value: string };

function toHeaderList(h?: Record<string, string>): HarNameValue[] {
  return h ? Object.entries(h).map(([name, value]) => ({ name, value })) : [];
}

// HAR analysers expect a parseable URL. REST/artwork entries already have an http(s) URL; a raw
// stream path (no scheme) is wrapped in app:// so tools render it instead of choking on it.
function toUrl(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `app://${raw.replace(/^\/+/, '')}`;
}

export function buildHar(entries: NetworkLogEntry[]) {
  // HAR entries are conventionally chronological; our store keeps newest-first.
  const ordered = [...entries].sort((a, b) => a.startedAt - b.startedAt);
  return {
    log: {
      version: '1.2',
      creator: CREATOR,
      entries: ordered.map((e) => ({
        startedDateTime: new Date(e.startedAt).toISOString(),
        time: e.durationMs,
        // Custom field (underscore prefix is reserved for tooling per the spec) so the http /
        // img / stream distinction survives the round-trip into analysers.
        _resonanceKind: e.kind,
        request: {
          method: e.kind === 'http' ? e.method : 'GET',
          url: toUrl(e.fullUrl ?? e.url),
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: toHeaderList(e.requestHeaders),
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: e.status ?? 0,            // 0 = no response received (timeout / native error)
          statusText: e.error ?? '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: toHeaderList(e.responseHeaders),
          content: { size: 0, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        // We only measure end-to-end latency, so attribute it all to `wait`. send+wait+receive
        // must equal `time` for the file to validate.
        timings: { send: 0, wait: e.durationMs, receive: 0 },
      })),
    },
  };
}

function timestampedName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `resonance-network-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.har`;
}

export interface HarExportResult {
  ok: boolean;
  reason?: string;   // error to surface
  message?: string;  // success/info to surface (e.g. "Saved …")
}

const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
// FLAG_GRANT_READ_URI_PERMISSION — lets the receiving viewer app read our content:// URI.
const FLAG_GRANT_READ_URI_PERMISSION = 1;

// Write the HAR to the cache dir. Returns the file or a user-facing error reason.
function writeHarFile(entries: NetworkLogEntry[]): { file: File } | { error: string } {
  const json = JSON.stringify(buildHar(entries), null, 2);
  const file = new File(Paths.cache, timestampedName());
  try {
    file.create({ overwrite: true });
    file.write(json);
    return { file };
  } catch (e) {
    return { error: `Could not write file — ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

async function shareFile(file: File): Promise<HarExportResult> {
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: 'Sharing is not available on this device.' };
  }
  // shareAsync resolves once the sheet is dismissed (including cancel), so there's nothing to inspect.
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export network log (HAR)',
    UTI: 'public.json',
  });
  return { ok: true };
}

/** Build a HAR from the captured entries, write it, and open the share sheet (send / save). */
export async function exportNetworkLogAsHar(entries: NetworkLogEntry[]): Promise<HarExportResult> {
  if (entries.length === 0) return { ok: false, reason: 'No requests captured yet.' };
  const written = writeHarFile(entries);
  if ('error' in written) return { ok: false, reason: written.error };
  return shareFile(written.file);
}

/**
 * Save the HAR to a folder the user picks (e.g. Downloads). Uses the Storage Access Framework
 * directory picker on Android so the file lands somewhere the user can browse to and copy off the
 * device — no share target required. On iOS (no SAF) it falls back to the share sheet's "Save to Files".
 */
export async function saveNetworkLogToFolder(entries: NetworkLogEntry[]): Promise<HarExportResult> {
  if (entries.length === 0) return { ok: false, reason: 'No requests captured yet.' };

  if (Platform.OS !== 'android') {
    const written = writeHarFile(entries);
    if ('error' in written) return { ok: false, reason: written.error };
    return shareFile(written.file);
  }

  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return { ok: true }; // user dismissed the folder picker — not an error
  }

  try {
    const name = timestampedName();
    const file = dir.createFile(name, 'application/json');
    file.write(JSON.stringify(buildHar(entries), null, 2));
    return { ok: true, message: `Saved ${name} to the selected folder.` };
  } catch (e) {
    return { ok: false, reason: `Could not save — ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

/**
 * Build a HAR and open it directly in a viewer (the installed HAR reader). On Android this fires an
 * ACTION_VIEW intent so the system routes straight to the reader; if no app can view it, it falls
 * back to the share sheet. iOS has no ACTION_VIEW equivalent, so it uses share / Quick Look.
 */
export async function openNetworkLogInHarReader(entries: NetworkLogEntry[]): Promise<HarExportResult> {
  if (entries.length === 0) return { ok: false, reason: 'No requests captured yet.' };
  const written = writeHarFile(entries);
  if ('error' in written) return { ok: false, reason: written.error };

  if (Platform.OS !== 'android') return shareFile(written.file);

  try {
    const contentUri = await getContentUriAsync(written.file.uri);
    await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
      data:  contentUri,
      type:  'application/json',
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return { ok: true };
  } catch {
    // No registered viewer (or the chooser failed) — fall back to the share sheet so the export
    // still goes somewhere useful.
    return shareFile(written.file);
  }
}
