// <copyright file="background.js" company="John Narey">
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

// Uses webextension-polyfill (browser-polyfill.js) for Firefox compat.
// On Chromium this file is the service worker; on Firefox it runs as an event page.

const ALARM_NAME = 'ytcookie-hourly';
const DEBOUNCE_MS = 5000;

let debounceTimer = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) syncCookies();
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo.cookie.domain.includes('youtube.com')) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncCookies, DEBOUNCE_MS);
});

async function syncCookies() {
  const { serverUrl, apiKey } = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  if (!serverUrl || !apiKey) return;

  try {
    const server = new URL(serverUrl);
    if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) {
      throw new Error('Cookie sync requires an HTTPS server URL without embedded credentials, query or fragment.');
    }

    const cookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expirationDate ? Math.round(c.expirationDate) : 0;
      lines.push(`${c.domain}\tTRUE\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
    }
    const fileContent = lines.join('\n');
    const blob = new Blob([fileContent], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, 'cookies.txt');

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v0/ytdlp/cookies`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'X-API-Key': apiKey },
      body: formData,
    });

    const result = { success: response.ok, timestamp: new Date().toISOString() };
    if (!response.ok) result.error = `HTTP ${response.status}`;
    await chrome.storage.local.set({ lastSync: result });
  } catch (err) {
    await chrome.storage.local.set({ lastSync: { success: false, timestamp: new Date().toISOString(), error: err.message } });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SYNC_NOW') {
    syncCookies().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
