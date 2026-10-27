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
