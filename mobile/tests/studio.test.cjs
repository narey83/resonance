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

test('output profiles preserve independent settings and restore both after restart', async () => {
  const storage = secureStorage(); const store = loadStore(storage); await store.getState().load();
  store.getState().setEq(0, 2); store.getState().setBassControl(.4); store.getState().setSmoothness(.3);
  store.getState().setAmount(.75); store.getState().setValue(0, .2); store.getState().setEnabled(true);
  store.getState().setBypass(true); store.getState().setOutputProfile('speakers');
  assert.equal(store.getState().bypass, false); assert.equal(store.getState().eq[0], 0);
  assert.equal(store.getState().enabled, false);
  store.getState().setEq(0, -.5); store.getState().setSmoothness(.1); store.getState().setEnabled(true);
  await new Promise(setImmediate);
  const restarted = loadStore(storage); await restarted.getState().load();
  assert.equal(restarted.getState().outputProfile, 'speakers'); assert.equal(restarted.getState().eq[0], -.5);
  restarted.getState().setOutputProfile('headphones');
  assert.equal(restarted.getState().eq[0], 2); assert.equal(restarted.getState().bassControl, .4);
  assert.equal(restarted.getState().smoothness, .3); assert.equal(restarted.getState().amount, .75);
  assert.equal(restarted.getState().values[0], .2); assert.equal(restarted.getState().enabled, true);
});

test('legacy settings migrate to headphones without inventing EQ or altering presets', async () => {
  const storage = secureStorage({ resonance_studio_v1: JSON.stringify({ enabled: true, values: [.2], presets: [{ name: 'Old', values: [.1] }] }) });
  const store = loadStore(storage); await store.getState().load();
  assert.equal(store.getState().values[0], .2); assert.equal(store.getState().outputProfile, 'headphones');
  assert.equal(store.getState().amount, 1); assert.deepEqual(store.getState().eq, Array(8).fill(0));
  assert.deepEqual(store.getState().presets[0].tone.eq, Array(8).fill(0));
  store.getState().setOutputProfile('speakers'); assert.equal(store.getState().values[0], 0);
  store.getState().setOutputProfile('headphones'); assert.equal(store.getState().values[0], .2);
});

test('tone presets preserve full settings and selection while Amount is adjusted', async () => {
  const storage = secureStorage(); const store = loadStore(storage); await store.getState().load();
  const { STUDIO_PRESETS, presetTone } = mobileModules()('src/lib/studio.ts');
  const preset = STUDIO_PRESETS.find(p => p.name === 'Resonance Enhance');
  store.getState().apply(preset.values, `builtin:${preset.name}`, presetTone(preset, 'headphones'));
  store.getState().setAmount(.4); await new Promise(setImmediate);
  const restarted = loadStore(storage); await restarted.getState().load();
  assert.equal(restarted.getState().selectedPresetId, 'builtin:Resonance Enhance');
  assert.equal(restarted.getState().amount, .4); assert.equal(restarted.getState().eq[0], 2.2);
  restarted.getState().savePreset('Full rack'); const saved = restarted.getState().presets[0];
  restarted.getState().apply(Array(11).fill(0));
  restarted.getState().apply(saved.values, 'saved:Full rack', saved.tone);
  assert.equal(restarted.getState().smoothness, .25); assert.equal(restarted.getState().amount, .4);
  restarted.getState().setEq(0, 1); assert.equal(restarted.getState().selectedPresetId, null);
});

test('tone input and malformed stored profiles are clamped without nonfinite values', async () => {
  const store = loadStore(secureStorage({ resonance_studio_v1: JSON.stringify({ outputProfile: 'invalid', profiles: { headphones: { eq: [999,-999,'loud'], bassControl: 100, smoothness: -1, amount: 'invalid' } } }) }));
  await store.getState().load();
  assert.equal(store.getState().outputProfile, 'headphones'); assert.deepEqual(store.getState().eq, [6,-6,0,0,0,0,0,0]);
  assert.equal(store.getState().bassControl, 1); assert.equal(store.getState().smoothness, 0); assert.equal(store.getState().amount, 1);
  store.getState().setEq(0, NaN); store.getState().setBassControl(Infinity); store.getState().setSmoothness(NaN);
  store.getState().setAmount(-1); store.getState().setEq(-1, 3); store.getState().setEq(8, 3);
  assert.equal(store.getState().eq[0], 0); assert.equal(store.getState().eq.length, 8);
  assert.equal(store.getState().bassControl, 0); assert.equal(store.getState().smoothness, 0); assert.equal(store.getState().amount, 0);
});

test('an obsolete tone selection cannot survive edits or missing saved presets across profiles', async () => {
  const store = loadStore(secureStorage({ resonance_studio_v1: JSON.stringify({ profiles: { headphones: { values: [], selectedPresetId: 'builtin:Clean', eq: [2] } } }) }));
  await store.getState().load(); assert.equal(store.getState().selectedPresetId, null);
  store.getState().savePreset('Oldest'); const preset = store.getState().presets[0];
  store.getState().apply(preset.values, 'saved:Oldest', preset.tone); store.getState().setOutputProfile('speakers');
  for (let i=0;i<12;i++) store.getState().savePreset(`New ${i}`);
  store.getState().setOutputProfile('headphones'); assert.equal(store.getState().selectedPresetId, null);
});

test('failed profile writes report the error and retain the previous stored settings', async () => {
  const storage = secureStorage({ resonance_studio_v1: JSON.stringify({ values: [.1] }) });
  storage.setItemAsync = async () => { throw new Error('Storage unavailable'); };
  const store = loadStore(storage); await store.getState().load();
  store.getState().setOutputProfile('speakers'); store.getState().setEq(0, 1);
  await new Promise(setImmediate);
  assert.equal(store.getState().error, 'Could not save Studio settings.');
  const restarted = loadStore(storage); await restarted.getState().load();
  assert.equal(restarted.getState().outputProfile, 'headphones'); assert.equal(restarted.getState().values[0], .1);
});

test('section reset changes only the current profile and saves once while preserving tone and session settings', async () => {
  const { STUDIO_MODULES } = mobileModules()('src/lib/studio.ts');
  for (const section of ['mastering','creative']) {
    const storage = secureStorage(); let writes = 0;
    const save = storage.setItemAsync;
    storage.setItemAsync = async (...args) => { writes++; return save(...args); };
    const store = loadStore(storage); await store.getState().load();
    store.getState().setOutputProfile('speakers'); store.getState().setValue(0, .2); store.getState().setEq(0, -1);
    store.getState().setOutputProfile('headphones');
    store.getState().apply(Array(11).fill(.1), undefined, { eq: [1.5], bassControl: .4, smoothness: .3, amount: .7 });
    store.getState().savePreset('Full rack'); const preset = store.getState().presets[0];
    store.getState().apply(preset.values, 'saved:Full rack', preset.tone);
    store.getState().setEnabled(true); store.getState().setPushed(true); store.getState().setBypass(true);
    await new Promise(setImmediate); writes = 0;
    const before = store.getState();
    store.getState().resetSection(section);
    const after = store.getState();
    assert.deepEqual(after.values, before.values.map((value, index) => STUDIO_MODULES[index].group === section ? 0 : value));
    assert.equal(after.selectedPresetId, null);
    for (const field of ['eq','bassControl','smoothness','amount','enabled','disabled','pushed','bypass','presets','outputProfile']) assert.deepEqual(after[field], before[field], field);
    await new Promise(setImmediate); assert.equal(writes, 1);
    const restarted = loadStore(storage); await restarted.getState().load();
    assert.deepEqual(restarted.getState().values, after.values);
    assert.deepEqual(restarted.getState().eq, after.eq); assert.equal(restarted.getState().amount, .7);
    restarted.getState().setOutputProfile('speakers');
    assert.equal(restarted.getState().values[0], .2); assert.equal(restarted.getState().eq[0], -1);
  }
});

test('unknown and already neutral section resets leave settings, preset selection and storage untouched', async () => {
  const storage = secureStorage(); let writes = 0;
  const save = storage.setItemAsync;
  storage.setItemAsync = async (...args) => { writes++; return save(...args); };
  const store = loadStore(storage); await store.getState().load();
  store.getState().apply(Array(11).fill(.1)); store.getState().savePreset('Unchanged');
  const preset = store.getState().presets[0]; store.getState().apply(preset.values, 'saved:Unchanged', preset.tone);
  await new Promise(setImmediate); writes = 0;
  for (const section of ['tone','missing',undefined]) store.getState().resetSection(section);
  await new Promise(setImmediate);
  assert.deepEqual(store.getState().values, Array(11).fill(.1)); assert.equal(store.getState().selectedPresetId, 'saved:Unchanged');
  assert.equal(writes, 0);
  store.getState().apply(Array(11).fill(0), 'builtin:Clean');
  await new Promise(setImmediate); writes = 0;
  store.getState().resetSection('mastering'); store.getState().resetSection('creative');
  await new Promise(setImmediate);
  assert.equal(store.getState().selectedPresetId, 'builtin:Clean'); assert.equal(writes, 0);
});
