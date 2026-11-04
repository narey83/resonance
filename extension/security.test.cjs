const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function sync(serverUrl) {
  let cookieReads = 0;
  const requests = [];
  const updates = [];
  const context = vm.createContext({
    URL, Blob, FormData, setTimeout, clearTimeout,
    fetch: async (...args) => { requests.push(args); return { ok: true }; },
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
      alarms: { onAlarm: { addListener() {} } },
      cookies: { onChanged: { addListener() {} }, getAll: async () => { cookieReads++; return []; } },
      storage: { local: { get: async () => ({ serverUrl, apiKey: 'synthetic-key' }), set: async (value) => updates.push(value) } },
    },
  });
  vm.runInContext(fs.readFileSync(__dirname + '/background.js', 'utf8'), context);
  await vm.runInContext('syncCookies()', context);
  return { cookieReads, requests, updates };
}

test('unsafe and saved legacy URLs are rejected before reading cookies', async () => {
  for (const url of ['http://192.168.1.20:5030', 'https://user:password@example.invalid', 'https://example.invalid/?token=x', 'invalid']) {
    const result = await sync(url);
    assert.equal(result.cookieReads, 0);
    assert.equal(result.requests.length, 0);
    assert.equal(result.updates[0].lastSync.success, false);
  }
});

test('HTTPS sync retains cookies endpoint and forbids redirect replay', async () => {
  const result = await sync('https://example.invalid/resonance/');
  assert.equal(result.cookieReads, 1);
  assert.equal(result.requests[0][0], 'https://example.invalid/resonance/api/v0/ytdlp/cookies');
  assert.equal(result.requests[0][1].redirect, 'error');
  assert.equal(result.requests[0][1].headers['X-API-Key'], 'synthetic-key');
  assert.equal(result.updates[0].lastSync.success, true);
});
