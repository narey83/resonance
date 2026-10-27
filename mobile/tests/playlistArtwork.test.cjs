const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('private artwork uses a scoped signature and never leaks the account token', async () => {
  const cache = new Map();
  const load = mobileModules({
    'src/services/imageUpload.ts': {},
    'src/api/client.ts': { apiClient: { get: async () => ({ data: [{ id: 'p1', tracks: [], artworkSig: 'image-only', artworkExp: 9999999999 }] }) } },
    'src/store/auth.ts': { useAuthStore: { getState: () => ({ serverUrl: 'http://server.test', accessToken: 'ACCOUNT-SECRET' }) } },
    'src/api/streamSignatures.ts': { seedSignatures: rows => rows.forEach(r => cache.set(r.path, r)), signedQuery: path => { const s = cache.get(path); return s ? `&exp=${s.exp}&sig=${s.sig}` : ''; } },
  });
  const api = load('src/api/mixtapes.ts');
  await api.getAll();
  const url = api.getMixtapeArtworkUrl('p1', 96);
  assert.match(url, /size=96&exp=9999999999&sig=image-only/);
  assert.doesNotMatch(url, /access_token|ACCOUNT-SECRET/);
});
