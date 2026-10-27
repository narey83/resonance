const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, tick } = require('./helpers.cjs');
function setup({ platform = 'ios', connected = false, available = true } = {}) {
  const listeners = new Map(), calls = [], completions = [];
  let hasNode = true;
  const native = { ready: async () => connected, finish: (...args) => completions.push(args) };
  const load = mobileModules({
    'react-native': { Platform: { OS: platform }, NativeModules: { ResonanceCarPlay: available ? native : null },
      NativeEventEmitter: class { addListener(name, listener) { listeners.set(name, listener); } } },
    'src/store/appSettingsStore.ts': { useAppSettings: { getState: () => ({ loaded: false, load: async () => calls.push('settings') }) } },
    'src/store/appModeStore.ts': { useAppMode: { getState: () => ({ loaded: false, load: async () => calls.push('mode') }) } },
    'src/store/auth.ts': { useAuthStore: { getState: () => ({ isReady: false, hydrate: async () => calls.push('auth') }) } },
    'src/services/playerSetup.ts': { ensurePlayerSetup: async () => calls.push('player') },
    'src/services/androidAuto.ts': {
      clearAndroidAutoTree: async () => calls.push('clear'),
      buildAndroidAutoTree: async () => calls.push('build'), handleAndroidAutoBrowse: async id => calls.push(['browse', id]),
      hasCarBrowseNode: () => hasNode,
      playAndroidAutoMediaId: async (...args) => calls.push(['play', ...args]),
    },
    'src/api/remoteLogger.ts': { remoteLog: (...args) => calls.push(['log', ...args]) },
  });
  const service = load('src/services/carPlay.ts');
  return { service, listeners, calls, completions, missing: () => { hasNode = false; } };
}
test('a cold CarPlay connection restores startup mode and session before building its library', async () => {
  const app = setup({ connected: true }); app.service.registerCarPlay(); app.service.registerCarPlay(); await tick();
  assert.equal(app.listeners.size, 2);
  assert.deepEqual(app.calls, ['settings', 'mode', 'auth', 'player', 'clear', 'build']);
});
test('car track selection routes through the shared queue and completes native selection', async () => {
  const app = setup(); app.service.registerCarPlay(); await tick();
  await app.listeners.get('carplay-action')({ kind: 'play', mediaId: 'file:///track.flac', requestId: 'one' });
  assert.deepEqual(app.calls.at(-1), ['play', 'file:///track.flac', true]);
  assert.deepEqual(app.completions, [['one', null]]);
});
test('missing browse nodes produce a retryable error instead of a permanently loading car row', async () => {
  const app = setup(); app.service.registerCarPlay(); app.missing(); await tick();
  await app.listeners.get('carplay-action')({ kind: 'browse', mediaId: 'album', requestId: 'two' });
  assert.match(app.completions[0][1], /connection|permissions/);
});
test('Android and old iOS builds never attempt to register the CarPlay bridge', async () => {
  for (const options of [{ platform: 'android' }, { available: false }]) {
    const app = setup(options); app.service.registerCarPlay(); await tick();
    assert.equal(app.listeners.size, 0); assert.equal(app.calls.length, 0);
  }
});
