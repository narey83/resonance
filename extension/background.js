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
