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
        <input id="serverUrl" placeholder="http://192.168.0.254:5030" type="url" />
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
