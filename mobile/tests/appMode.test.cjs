const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, secureStorage } = require('./helpers.cjs');

test('startup asks once and remembers either local or remote music', async () => {
  const storage = secureStorage();
  const loadMode = () => mobileModules({ 'expo-secure-store': storage })('src/store/appModeStore.ts').useAppMode;
  const first = loadMode();
  await first.getState().load();
  assert.equal(first.getState().mode, 'choose');
  for (const choice of ['local', 'remote']) {
    await first.getState().select(choice);
    const restarted = loadMode();
    await restarted.getState().load();
    assert.equal(restarted.getState().mode, choice);
  }
});

test('entering local mode cancels server login and enables the local library', async () => {
  const calls = [];
  const load = mobileModules({
    'expo-secure-store': secureStorage(),
    'src/store/auth.ts': { useAuthStore: { getState: () => ({ clearTokens: async () => calls.push('clear') }) } },
    'src/store/librarySettingsStore.ts': { useLibrarySettings: { getState: () => ({
      setIncludeLocalLibrary: async value => calls.push(['include', value]),
      setMergeLocalAndServer: async value => calls.push(['merge', value]),
    }) } },
  });
  await load('src/services/appMode.ts').enterLocalMode();
  assert.deepEqual(calls, ['clear', ['include', true], ['merge', false]]);
  assert.equal(load('src/store/appModeStore.ts').useAppMode.getState().mode, 'local');
});
