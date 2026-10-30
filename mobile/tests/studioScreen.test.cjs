const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileModules, secureStorage } = require('./helpers.cjs');

function screen({ available = true, casting = false, enhanced = true } = {}) {
  const store = mobileModules({ 'expo-secure-store': secureStorage() })('src/store/studioStore.ts').useStudio;
  const effects = [], configurations = [];
  let hook = 0; const hookState = [];
  const native = { version: enhanced ? 2 : 1, configure: async config => { configurations.push(config); } };
  const load = mobileModules({
    react: { ...React, useState: initial => { const index = hook++; if (index >= hookState.length) hookState[index] = initial; return [hookState[index], value => { hookState[index] = value; }]; }, useEffect: effect => effects.push(effect) },
    'react-native': {
      NativeModules: available ? { ResonanceStudio: native } : {},
      TurboModuleRegistry: { get: () => available ? native : undefined },
      Alert: {}, StyleSheet: { create: styles => styles },
      Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
      Text: 'Text', TextInput: 'TextInput', View: 'View',
    },
    'src/theme.ts': { Editorial: {}, Typography: {} },
    'src/context/ThemeContext.ts': { useTheme: () => ({ colors: { accent: 'accent', borderStrong: 'border', bgElevated: 'elevated' } }) },
    'src/context/CastContext.ts': { useCast: () => ({ isCasting: casting }) },
    'src/store/studioStore.ts': { useStudio: Object.assign(() => store.getState(), store) },
  });
  const { StudioRack } = load('src/screens/more/StudioScreen.tsx');
  const StudioController = load('src/components/StudioController.tsx').default;
  const nodes = () => {
    const result = [];
    const visit = node => {
      if (!React.isValidElement(node)) return;
      result.push(node);
      React.Children.forEach(node.props.children, visit);
    };
    hook = 0;
    visit(StudioRack({}));
    return result;
  };
  const syncEngine = () => {
    effects.length = 0;
    StudioController();
    effects.forEach(effect => effect());
  };
  return { store, nodes, configurations, syncEngine };
}
const button = (nodes, name) => nodes.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === name);
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : String(node ?? '');

test('preset buttons highlight and announce only the selected preset', async () => {
  const { store, nodes } = screen();
  await store.getState().load();
  button(nodes(), 'Warm pressing').props.onPress();
  const selected = button(nodes(), 'Warm pressing');
  assert.equal(selected.props.accessibilityState.selected, true);
  assert.equal(text(selected), 'Warm pressing');
  assert.equal(selected.props.style.at(-1).borderColor, 'accent');
  assert.equal(button(nodes(), 'Clean').props.accessibilityState.selected, false);
  assert.ok(nodes().some(node => node.props.accessibilityLiveRegion === 'polite' && text(node) === 'Warm pressing · Active'));
  button(nodes(), 'Drum focus').props.onPress();
  assert.equal(button(nodes(), 'Warm pressing').props.accessibilityState.selected, false);
  assert.equal(button(nodes(), 'Drum focus').props.accessibilityState.selected, true);
  store.getState().setBypass(true);
  assert.equal(button(nodes(), 'Drum focus').props.accessibilityState.selected, false);
  assert.ok(nodes().some(node => text(node) === 'Drum focus · Bypassed for dry comparison'));
  store.getState().setEnabled(false);
  assert.equal(button(nodes(), 'Drum focus').props.accessibilityState.selected, false);
  assert.ok(nodes().some(node => text(node) === 'Drum focus · Rack off'));
  store.getState().setValue(0, .2);
  assert.equal(button(nodes(), 'Drum focus').props.accessibilityState.selected, false);
});

test('saved presets select correctly and unavailable routes disable selection', async () => {
  const { store, nodes } = screen();
  await store.getState().load();
  store.getState().savePreset('My rack');
  button(nodes(), 'My rack').props.onPress();
  assert.equal(button(nodes(), 'My rack').props.accessibilityState.selected, true);
  assert.equal(button(nodes(), 'Clean').props.accessibilityState.selected, false);
  for (const options of [{ available: false }, { casting: true }]) {
    const unavailable = screen(options);
    await unavailable.store.getState().load();
    assert.equal(button(unavailable.nodes(), 'Clean').props.disabled, true);
    assert.equal(button(unavailable.nodes(), 'Clean').props.accessibilityState.disabled, true);
  }
});

test('rack renders without audio meters or native meter polling', async () => {
  const { store, nodes } = screen();
  await store.getState().load();
  const content = text(nodes()[0]);
  for (const label of ['Input', 'Output', 'Limiter reduction', 'Stereo correlation', 'WAITING FOR HANDSET AUDIO', 'Studio is not receiving audio']) {
    assert.equal(content.includes(label), false, label);
  }
  assert.ok(content.includes('Eight-band EQ'));
  nodes().find(node => node.type === 'Pressable' && text(node) === 'MASTERING').props.onPress();
  assert.ok(text(nodes()[0]).includes('Harmonic exciter'));
  assert.ok(content.includes('Processing rack'));
});

test('pressing an active preset toggles processing off and back on without ticks', async () => {
  const { store, nodes } = screen();
  await store.getState().load();
  for (const name of ['Warm pressing', 'Drum focus']) {
    button(nodes(), name).props.onPress();
    const values = [...store.getState().values];
    assert.equal(store.getState().enabled, true);
    assert.equal(button(nodes(), name).props.accessibilityState.selected, true);
    assert.equal(text(button(nodes(), name)), name);
    button(nodes(), name).props.onPress();
    assert.equal(store.getState().enabled, false);
    assert.equal(button(nodes(), name).props.accessibilityState.selected, false);
    assert.equal(button(nodes(), name).props.style.at(-1), false);
    assert.deepEqual(store.getState().values, values);
    button(nodes(), name).props.onPress();
    assert.equal(store.getState().enabled, true);
    assert.equal(button(nodes(), name).props.accessibilityState.selected, true);
    assert.deepEqual(store.getState().values, values);
  }
});

test('saved presets toggle off too, and pressing a bypassed preset restores processing', async () => {
  const { store, nodes } = screen();
  await store.getState().load();
  store.getState().setValue(0, .2);
  store.getState().savePreset('My rack');
  button(nodes(), 'My rack').props.onPress();
  button(nodes(), 'My rack').props.onPress();
  assert.equal(store.getState().enabled, false);
  assert.equal(button(nodes(), 'My rack').props.accessibilityState.selected, false);
  button(nodes(), 'My rack').props.onPress();
  store.getState().setBypass(true);
  assert.equal(button(nodes(), 'My rack').props.accessibilityState.selected, false);
  button(nodes(), 'My rack').props.onPress();
  assert.equal(store.getState().enabled, true);
  assert.equal(store.getState().bypass, false);
  assert.equal(button(nodes(), 'My rack').props.accessibilityState.selected, true);
  assert.equal(store.getState().values[0], .2);
});

test('A/B toggles the native bridge between dry and processed without changing rack settings', async () => {
  const { store, nodes, configurations, syncEngine } = screen();
  await store.getState().load();
  const comparison = label => nodes().find(node => node.type === 'Pressable' && text(node) === label);
  assert.equal(comparison('B / Processed').props.disabled, true);
  button(nodes(), 'Warm pressing').props.onPress();
  syncEngine();
  const processed = configurations.at(-1);
  assert.equal(processed.enabled, true);
  assert.equal(processed.bypass, false);
  comparison('B / Processed').props.onPress();
  syncEngine();
  assert.deepEqual(configurations.at(-1), { ...processed, bypass: true });
  assert.equal(comparison('A / Dry comparison').props.accessibilityState.selected, true);
  assert.equal(store.getState().selectedPresetId, 'builtin:Warm pressing');
  comparison('A / Dry comparison').props.onPress();
  syncEngine();
  assert.deepEqual(configurations.at(-1), processed);
  assert.equal(comparison('B / Processed').props.accessibilityState.selected, false);
  assert.equal(button(nodes(), 'Warm pressing').props.accessibilityState.selected, true);
  button(nodes(), 'Warm pressing').props.onPress();
  syncEngine();
  assert.equal(configurations.at(-1).enabled, false);
  assert.equal(comparison('B / Processed').props.disabled, true);
});

test('A/B preserves disabled modules and is unavailable for casting or missing native support', async () => {
  const { store, nodes, configurations, syncEngine } = screen();
  await store.getState().load();
  button(nodes(), 'Warm pressing').props.onPress();
  store.getState().toggleModule(0);
  syncEngine();
  const values = [...configurations.at(-1).values];
  assert.equal(values[0], 0);
  assert.ok(store.getState().values[0] > 0);
  for (const label of ['B / Processed', 'A / Dry comparison']) {
    nodes().find(node => node.type === 'Pressable' && text(node) === label).props.onPress();
    syncEngine();
    assert.deepEqual(configurations.at(-1).values, values);
  }
  for (const options of [{ available: false }, { casting: true }]) {
    const unavailable = screen(options);
    await unavailable.store.getState().load();
    unavailable.store.getState().setEnabled(true);
    const ab = unavailable.nodes().find(node => node.type === 'Pressable' && text(node) === 'B / Processed');
    assert.equal(ab.props.disabled, true);
  }
});


test('new presets apply the output recipe and Amount survives toggling off and on', async () => {
  const { store, nodes, configurations, syncEngine } = screen();
  await store.getState().load();
  button(nodes(), 'Resonance Enhance').props.onPress();
  syncEngine();
  assert.equal(store.getState().amount, .65);
  assert.equal(configurations.at(-1).eq.length, 8);
  assert.equal(configurations.at(-1).eq[0], 2.2);
  assert.equal(configurations.at(-1).bassControl, .35);
  button(nodes(), 'Increase Preset amount').props.onPress();
  const amount = store.getState().amount;
  assert.ok(amount > .65);
  button(nodes(), 'Resonance Enhance').props.onPress();
  button(nodes(), 'Resonance Enhance').props.onPress();
  assert.equal(store.getState().amount, amount);
  assert.equal(store.getState().enabled, true);
  button(nodes(), 'Speakers').props.onPress();
  assert.equal(store.getState().outputProfile, 'speakers');
  assert.ok(store.getState().eq.every(v => v === 0));
  button(nodes(), 'Resonance Enhance').props.onPress();
  assert.equal(store.getState().eq[0], .6);
  button(nodes(), 'Headphones and earbuds').props.onPress();
  assert.equal(store.getState().eq[0], 2.2);
  assert.equal(store.getState().amount, amount);
});

test('EQ, tone controls and saved tone presets reach the native bridge', async () => {
  const { store, nodes, configurations, syncEngine } = screen();
  await store.getState().load();
  button(nodes(), 'Increase EQ 60 Hz').props.onPress();
  button(nodes(), 'Increase Bass control').props.onPress();
  button(nodes(), 'Increase Smoothness').props.onPress();
  store.getState().savePreset('My tone');
  button(nodes(), 'Clean').props.onPress();
  assert.equal(store.getState().eq[0], 0);
  button(nodes(), 'My tone').props.onPress();
  syncEngine();
  assert.equal(configurations.at(-1).eq[0], .5);
  assert.equal(configurations.at(-1).bassControl, .05);
  assert.equal(configurations.at(-1).smoothness, .05);
  button(nodes(), 'Reset EQ').props.onPress();
  assert.ok(store.getState().eq.every(v => v === 0));
  assert.equal(store.getState().selectedPresetId, null);
});

test('older native builds retain legacy presets and disable unsupported tone features', async () => {
  const { store, nodes } = screen({ enhanced: false });
  await store.getState().load();
  assert.equal(button(nodes(), 'Resonance Enhance').props.disabled, true);
  assert.equal(button(nodes(), 'Increase EQ 60 Hz').props.disabled, true);
  assert.equal(button(nodes(), 'Increase Preset amount').props.disabled, true);
  assert.equal(button(nodes(), 'Warm pressing').props.disabled, false);
  assert.ok(text(nodes()[0]).includes('updated native app build'));
});

test('restored enhanced settings cannot silently run on an older native engine', async () => {
  const { store, configurations, syncEngine } = screen({ enhanced: false });
  await store.getState().load();
  store.getState().setEq(0, 1); store.getState().setEnabled(true); syncEngine();
  assert.equal(configurations.at(-1).enabled, false);
  store.getState().apply(Array(11).fill(0)); syncEngine();
  assert.equal(configurations.at(-1).enabled, true);
});
