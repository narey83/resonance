const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, secureStorage } = require('./helpers.cjs');

function settings(storage) {
  return mobileModules({ 'expo-secure-store': storage })('src/store/appSettingsStore.ts').useAppSettings;
}

test('track numbers default to hidden for new and existing settings', async () => {
  for (const saved of [null, { theme: 'dark', playerMode: 'bar' }]) {
    const storage = secureStorage(saved ? { app_settings_v1: JSON.stringify(saved) } : {});
    const store = settings(storage);
    assert.equal(store.getState().showTrackNumbers, false);
    await store.getState().load();
    assert.equal(store.getState().showTrackNumbers, false);
    if (saved) assert.equal(store.getState().theme, saved.theme);
  }
});

test('track number visibility survives reload and other settings changes', async () => {
  const storage = secureStorage();
  const store = settings(storage);
  await store.getState().load();
  await store.getState().setShowTrackNumbers(true);
  await store.getState().setPlayerMode('bubble');
  const restored = settings(storage);
  await restored.getState().load();
  assert.equal(restored.getState().showTrackNumbers, true);
  assert.equal(restored.getState().playerMode, 'bubble');
  await restored.getState().setShowTrackNumbers(false);
  const hidden = settings(storage);
  await hidden.getState().load();
  assert.equal(hidden.getState().showTrackNumbers, false);
});

test('accent colour and handset matching survive reload and unrelated preference changes', async () => {
  const storage = secureStorage({ app_settings_v1: JSON.stringify({ theme: 'light' }) });
  const store = settings(storage);
  await store.getState().load();
  assert.equal(store.getState().accentColour, 'default');
  assert.equal(store.getState().theme, 'light');
  await store.getState().setAccentColour('olive');
  await store.getState().setTheme('system');
  await store.getState().setShowTrackNumbers(true);
  const restored = settings(storage);
  await restored.getState().load();
  assert.equal(restored.getState().accentColour, 'olive');
  assert.equal(restored.getState().theme, 'system');
  assert.equal(restored.getState().showTrackNumbers, true);
});

test('unknown saved appearance choices fall back safely without affecting other preferences', async () => {
  const storage = secureStorage({ app_settings_v1: JSON.stringify({ theme: 'retired-theme', accentColour: '#bad-value', playerMode: 'bubble' }) });
  const store = settings(storage);
  await store.getState().load();
  assert.equal(store.getState().theme, 'system');
  assert.equal(store.getState().accentColour, 'default');
  assert.equal(store.getState().playerMode, 'bubble');
});

test('the selected colour adapts to handset changes while semantic colours and manual appearances stay stable', () => {
  const load = mobileModules({ 'react-native': { Platform: { select: options => options.ios } } });
  const { themes } = load('src/theme.ts');
  const { resolvePalette, applyAccent } = load('src/lib/appearance.ts');
  const light = resolvePalette('system', 'light');
  const dark = resolvePalette('system', 'dark');
  const lightColours = applyAccent(themes[light], light, 'olive');
  const darkColours = applyAccent(themes[dark], dark, 'olive');
  assert.notEqual(lightColours.accent, darkColours.accent);
  assert.equal(lightColours.bgPrimary, themes.light.bgPrimary);
  assert.equal(darkColours.bgPrimary, themes.dark.bgPrimary);
  assert.equal(lightColours.danger, themes.light.danger);
  assert.equal(darkColours.success, themes.dark.success);
  assert.equal(themes.light.accent, '#B83D29');
  assert.equal(resolvePalette('midnight', 'light'), 'midnight');
  assert.equal(resolvePalette('system', null), 'dark');
  assert.equal(resolvePalette('system', 'unspecified'), 'dark');
});
