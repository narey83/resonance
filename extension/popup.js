// <copyright file="popup.js" company="John Narey">
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

const app = document.getElementById('app');

function fmt(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((now - d) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return d.toLocaleString();
}

function renderSetup() {
  app.innerHTML = `
    <div class="header">
      <div>
        <div class="header-title">Resonance Cookie Sync</div>
        <div class="header-subtitle">First time setup</div>
      </div>
    </div>
    <div class="body">
      <div class="field">
        <label>Resonance Server URL</label>
        <input id="serverUrl" placeholder="https://resonance.example.com" type="url" />
      </div>
      <div class="field">
        <label>API Key</label>
        <input id="apiKey" placeholder="your-api-key" type="password" />
      </div>
      <div id="setupError"></div>
      <div class="btn-row">
        <button class="btn btn--primary" id="saveBtn" type="button">Save &amp; Sync</button>
      </div>
    </div>
    <div class="footer">YouTube cookies will sync automatically every hour</div>
  `;

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const errEl = document.getElementById('setupError');

    if (!serverUrl || !apiKey) {
      errEl.innerHTML = '<div class="status status--error">Both fields are required.</div>';
      return;
    }

    try {
      const server = new URL(serverUrl);
      if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) {
        throw new Error('invalid server URL');
      }
    } catch {
      errEl.textContent = 'Enter an HTTPS server URL without embedded credentials, query or fragment.';
      return;
    }

    await chrome.storage.local.set({ serverUrl, apiKey });
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => renderMain());
  });
}

async function renderMain() {
  const { serverUrl, lastSync } = await chrome.storage.local.get(['serverUrl', 'lastSync']);

  let statusHtml = '';
  if (lastSync) {
    if (lastSync.success) {
      statusHtml = `<div class="status status--ok">Synced ${fmt(lastSync.timestamp)}</div>`;
    } else {
      statusHtml = `<div class="status status--error">Failed ${fmt(lastSync.timestamp)}: ${lastSync.error || 'unknown error'}</div>`;
    }
  } else {
    statusHtml = '<div class="status status--info">Not synced yet</div>';
  }

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="header-title">Resonance Cookie Sync</div>
        <div class="header-subtitle">${serverUrl}</div>
      </div>
    </div>
    <div class="body">
      ${statusHtml}
      <div class="btn-row">
        <button class="btn btn--primary" id="syncBtn" type="button">Sync Now</button>
        <button class="btn" id="editBtn" type="button">Edit Settings</button>
      </div>
    </div>
    <div class="footer">Auto-syncs hourly and on cookie changes</div>
  `;

  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => {
      setTimeout(renderMain, 500);
    });
  });

  document.getElementById('editBtn').addEventListener('click', renderSetup);
}

async function init() {
  const { serverUrl, apiKey } = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  if (serverUrl && apiKey) {
    renderMain();
  } else {
    renderSetup();
  }
}

init();
