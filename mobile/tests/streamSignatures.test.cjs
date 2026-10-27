const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('large queues sign in bounded batches and never send local paths to the server', async () => {
  const batches = [];
  const load = mobileModules({
    'src/api/client.ts': { apiClient: { post: async (_, { paths }) => {
      batches.push(paths);
      return { data: Object.fromEntries(paths.map(p => [p, { sig: 'signed', exp: 9999999999 }])) };
    } } },
    'src/api/remoteLogger.ts': { remoteLog() {} },
    'src/lib/sessionScope.ts': { onSessionReset() {}, sessionGuard: () => () => true },
  });
  const signatures = load('src/api/streamSignatures.ts');
  await signatures.ensureSigned([...Array.from({ length: 2200 }, (_, i) => `/music/${i}.mp3`), 'file:///local.mp3', 'content://local']);
  assert.deepEqual(batches.map(b => b.length), [1000, 1000, 200]);
  assert.equal(signatures.isSigned('/music/2199.mp3'), true);
  await signatures.ensureSigned(['/music/2199.mp3']);
  assert.equal(batches.length, 3);
});
