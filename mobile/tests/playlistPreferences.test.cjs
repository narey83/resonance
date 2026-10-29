const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, secureStorage } = require('./helpers.cjs');

function loadStore(file, storage) {
  return mobileModules({ 'expo-secure-store': storage })(file);
}

test('old Mixtapes tab settings migrate to Playlists without duplicates and enable independent local playlists', async () => {
  const storage = secureStorage({ library_settings_v1: JSON.stringify({
    version: 2,
    visibleTabsServer: ['Folders', 'Mixtapes', 'Playlists', 'Loved'],
    visibleTabsLocal: ['Folders', 'Mixtapes', 'Loved'],
  }) });
  const store = loadStore('src/store/librarySettingsStore.ts', storage).useLibrarySettings;
  await store.getState().load();
  assert.deepEqual(store.getState().visibleTabsServer, ['Folders', 'Crates', 'Playlists', 'Loved']);
  assert.deepEqual(store.getState().visibleTabsLocal, ['Folders', 'Playlists', 'Loved']);
  await store.getState().setVisibleTabs(['Folders', 'Playlists'], 'server');
  const restored = loadStore('src/store/librarySettingsStore.ts', storage).useLibrarySettings;
  await restored.getState().load();
  assert.deepEqual(restored.getState().visibleTabsServer, ['Folders', 'Playlists']);
});

test('renaming preserves a deliberately hidden playlists tab', async () => {
  const storage = secureStorage({ library_settings_v1: JSON.stringify({
    version: 2, visibleTabsServer: ['Folders', 'Loved'],
  }) });
  const store = loadStore('src/store/librarySettingsStore.ts', storage).useLibrarySettings;
  await store.getState().load();
  assert.deepEqual(store.getState().visibleTabsServer, ['Folders', 'Crates', 'Loved']);
});

test('saved playlist tile sizes migrate while newer preferences take precedence', async () => {
  for (const [saved, expected] of [[{ Mixtapes: 'large' }, 'large'], [{ Mixtapes: 'large', Playlists: 'small' }, 'small']]) {
    const storage = secureStorage({ library_view_modes_v1: JSON.stringify(saved) });
    const store = loadStore('src/store/libraryViewStore.ts', storage).useLibraryViewStore;
    await store.getState().load();
    assert.equal(store.getState().modes.Playlists, expected);
    assert.equal(store.getState().modes.Mixtapes, undefined);
  }
});

test('version 3 preserves a deliberately hidden device playlists tab', async () => {
  const store = loadStore('src/store/librarySettingsStore.ts', secureStorage({ library_settings_v1: JSON.stringify({ version: 3, visibleTabsLocal: ['Folders', 'Loved'] }) })).useLibrarySettings;
  await store.getState().load();
  assert.deepEqual(store.getState().visibleTabsLocal, ['Folders', 'Loved']);
});

 test('version 4 respects hidden server crates and never exposes them for device files', async () => {
  const storage = secureStorage({ library_settings_v1: JSON.stringify({ version: 4, visibleTabsServer: ['Folders', 'Loved'], visibleTabsLocal: ['Folders', 'Crates', 'Loved'] }) });
  const store = loadStore('src/store/librarySettingsStore.ts', storage).useLibrarySettings;
  await store.getState().load();
  assert.deepEqual(store.getState().visibleTabsServer, ['Folders', 'Loved']);
  assert.deepEqual(store.getState().visibleTabsLocal, ['Folders', 'Loved']);
});
