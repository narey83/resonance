const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, secureStorage } = require('./helpers.cjs');
const loadStore = storage => mobileModules({ 'expo-secure-store': storage })('src/store/studioStore.ts').useStudio;

test('extreme values require session consent and consent never survives a restart', async () => {
  const storage = secureStorage(); const store = loadStore(storage); await store.getState().load();
  store.getState().setValue(0, 1); assert.equal(store.getState().values[0], .35);
  store.getState().setPushed(true); store.getState().setValue(0, 1); assert.equal(store.getState().values[0], 1);
  store.getState().savePreset('Extreme'); store.getState().setBypass(true);
  await new Promise(setImmediate);
  const restarted = loadStore(storage); await restarted.getState().load();
  assert.equal(restarted.getState().pushed, false); assert.equal(restarted.getState().bypass, false);
  assert.equal(restarted.getState().values[0], .35); assert.equal(restarted.getState().presets[0].values[0], .35);
});
test('returning to controlled clamps every effect and invalid values cannot enter the rack', async () => {
  const store=loadStore(secureStorage()); await store.getState().load();
  store.getState().setPushed(true); store.getState().apply(Array(11).fill(1)); store.getState().setPushed(false);
  assert.ok(store.getState().values.every((v,i)=>i===5?v===1:v<=.4));
  store.getState().setValue(0,NaN); assert.equal(store.getState().values[0],0);
  store.getState().toggleModule(0); assert.equal(store.getState().disabled[0],true);
});
test('malformed saved data starts with protected finite values', async () => {
  const store=loadStore(secureStorage({resonance_studio_v1:JSON.stringify({pushed:true,values:[999,-1,'loud']})}));
  await store.getState().load(); assert.equal(store.getState().pushed,false);
  assert.deepEqual(store.getState().values.slice(0,3),[.35,0,0]);
});

test('preset selection survives restart, and edits clear the selection', async () => {
  const storage = secureStorage();
  const store = loadStore(storage);
  const { STUDIO_PRESETS } = mobileModules()('src/lib/studio.ts');
  await store.getState().load();
  store.getState().apply(STUDIO_PRESETS[1].values, 'builtin:Warm pressing');
  store.getState().setEnabled(true);
  store.getState().setBypass(true);
  store.getState().setPushed(true);
  assert.equal(store.getState().selectedPresetId, 'builtin:Warm pressing');
  await new Promise(setImmediate);
  const restarted = loadStore(storage);
  await restarted.getState().load();
  assert.equal(restarted.getState().selectedPresetId, 'builtin:Warm pressing');
  restarted.getState().setValue(0, .2);
  assert.equal(restarted.getState().selectedPresetId, null);
  restarted.getState().apply(STUDIO_PRESETS[2].values, 'builtin:Drum focus');
  restarted.getState().toggleModule(0);
  assert.equal(restarted.getState().selectedPresetId, null);
});

test('saved presets with built-in names keep their identity when reordered', async () => {
  const storage = secureStorage();
  const store = loadStore(storage);
  await store.getState().load();
  store.getState().setValue(0, .2);
  store.getState().savePreset('Clean');
  store.getState().apply(store.getState().presets[0].values, 'saved:Clean');
  store.getState().savePreset('Another');
  await new Promise(setImmediate);
  const restarted = loadStore(storage);
  await restarted.getState().load();
  assert.equal(restarted.getState().selectedPresetId, 'saved:Clean');
  restarted.getState().savePreset('Clean');
  assert.equal(restarted.getState().selectedPresetId, null);
});

test('stale, missing and malformed saved selections cannot appear selected', async () => {
  for (const data of [
    { selectedPresetId: 'builtin:Missing' },
    { selectedPresetId: { name: 'Clean' } },
    { selectedPresetId: 'builtin:Warm pressing' },
    { selectedPresetId: 'builtin:Clean', disabled: [true] },
    { selectedPresetId: 'saved:Removed' },
  ]) {
    const store = loadStore(secureStorage({ resonance_studio_v1: JSON.stringify(data) }));
    await store.getState().load();
    assert.equal(store.getState().selectedPresetId, null);
  }
});

test('clamping extreme values and applying unnamed settings clear selection', async () => {
  const store = loadStore(secureStorage());
  await store.getState().load();
  store.getState().setPushed(true);
  store.getState().apply(Array(11).fill(1), 'saved:Extreme');
  store.getState().setPushed(false);
  assert.equal(store.getState().selectedPresetId, null);
  store.getState().apply(Array(11).fill(0), 'builtin:Clean');
  store.getState().setValue(0, -1);
  assert.equal(store.getState().selectedPresetId, 'builtin:Clean');
  store.getState().apply(Array(11).fill(0));
  assert.equal(store.getState().selectedPresetId, null);
});


test('evicting a selected saved preset clears its selection', async () => {
  const store = loadStore(secureStorage());
  await store.getState().load();
  store.getState().savePreset('Oldest');
  store.getState().apply(store.getState().presets[0].values, 'saved:Oldest');
  for (let i = 0; i < 12; i++) store.getState().savePreset(`New ${i}`);
  assert.equal(store.getState().presets.length, 12);
  assert.equal(store.getState().selectedPresetId, null);
});
