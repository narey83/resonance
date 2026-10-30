const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileModules, secureStorage } = require('./helpers.cjs');

function screen({ available = true, casting = false, enhanced = true, slidersAvailable = true, storage = secureStorage() } = {}) {
  const store = mobileModules({ 'expo-secure-store': storage })('src/store/studioStore.ts').useStudio;
  const effects = [], configurations = [];
  let hook = 0; const hookState = [];
  const native = { version: enhanced ? 2 : 1, configure: async config => { configurations.push(config); } };
  const load = mobileModules({
    react: { ...React, useState: initial => { const index = hook++; if (index >= hookState.length) hookState[index] = initial; return [hookState[index], value => { hookState[index] = value; }]; }, useRef: initial => { const index = hook++; if (index >= hookState.length) hookState[index] = { current: initial }; return hookState[index]; }, useEffect: effect => effects.push(effect) },
    '@react-native-community/slider': 'NativeSlider',
    'react-native': {
      NativeModules: available ? { ResonanceStudio: native } : {},
      TurboModuleRegistry: { get: () => available ? native : undefined },
      UIManager: { hasViewManagerConfig: name => name === 'RNCSlider' && slidersAvailable },
      Alert: {}, StyleSheet: { create: styles => styles },
      Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
      Text: 'Text', TextInput: 'TextInput', View: 'View',
    },
    'src/theme.ts': { Editorial: {}, Typography: {} },
    'src/context/ThemeContext.ts': { useTheme: () => ({ colors: { accent: 'accent', danger: 'danger', borderStrong: 'border', bgElevated: 'elevated' } }) },
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
      if (typeof node.type === 'function') visit(node.type(node.props));
      else React.Children.forEach(node.props.children, visit);
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
const slider = (nodes, name) => nodes.find(node => node.type === 'NativeSlider' && node.props.accessibilityLabel === name);
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
  assert.ok(nodes().some(node => node.type === 'Text' && text(node) === 'Harmonic exciter'));
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
  slider(nodes(), 'Preset amount').props.onSlidingComplete(.7);
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
  slider(nodes(), 'EQ 60 Hz').props.onSlidingComplete(.5);
  slider(nodes(), 'Bass control').props.onSlidingComplete(.05);
  slider(nodes(), 'Smoothness').props.onSlidingComplete(.05);
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
  for (const label of ['EQ 60 Hz','Preset amount','Bass control','Smoothness']) assert.equal(slider(nodes(), label).props.disabled, true);
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

test('slider drags preview the audio immediately and save only the released value', async () => {
  const storage = secureStorage(); let writes = 0;
  const save = storage.setItemAsync;
  storage.setItemAsync = async (...args) => { writes++; return save(...args); };
  const { store, nodes, configurations, syncEngine } = screen({ storage });
  await store.getState().load();
  button(nodes(), 'Resonance Enhance').props.onPress();
  await new Promise(setImmediate); writes = 0;
  slider(nodes(), 'Preset amount').props.onSlidingStart();
  for (const value of [.5,.41,.42]) slider(nodes(), 'Preset amount').props.onValueChange(value);
  syncEngine(); await new Promise(setImmediate);
  assert.equal(configurations.at(-1).amount, .42);
  assert.equal(writes, 0);
  assert.equal(store.getState().selectedPresetId, 'builtin:Resonance Enhance');
  assert.equal(slider(nodes(), 'Preset amount').props.accessibilityValue.text, '42 percent');
  slider(nodes(), 'Preset amount').props.onSlidingComplete(.42000002);
  await new Promise(setImmediate);
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.values.get('resonance_studio_v1')).amount, .42);
  slider(nodes(), 'EQ 60 Hz').props.onSlidingStart();
  slider(nodes(), 'EQ 60 Hz').props.onValueChange(-2.5);
  syncEngine(); await new Promise(setImmediate);
  assert.equal(configurations.at(-1).eq[0], -2.5);
  assert.equal(store.getState().selectedPresetId, null);
  assert.equal(writes, 1);
  slider(nodes(), 'EQ 60 Hz').props.onSlidingComplete(-2.5);
  await new Promise(setImmediate);
  assert.equal(writes, 2);
  const restarted = mobileModules({ 'expo-secure-store': storage })('src/store/studioStore.ts').useStudio;
  await restarted.getState().load();
  assert.equal(restarted.getState().amount, .42);
  assert.equal(restarted.getState().eq[0], -2.5);
  assert.equal(button(nodes(), 'Increase Preset amount'), undefined);
  assert.equal(button(nodes(), 'Reduce EQ 60 Hz'), undefined);
});

test('slider limits and non-drag adjustments persist; disabled sliders reject changes', async () => {
  const storage = secureStorage();
  const { store, nodes } = screen({ storage }); await store.getState().load();
  // Accessibility and keyboard adjustments can emit value changes without touch start/end.
  slider(nodes(), 'Preset amount').props.onValueChange(.37000001);
  slider(nodes(), 'EQ 12 kHz').props.onValueChange(7);
  await new Promise(setImmediate);
  assert.equal(JSON.parse(storage.values.get('resonance_studio_v1')).amount, .37);
  assert.equal(store.getState().eq[7], 6);
  slider(nodes(), 'EQ 12 kHz').props.onValueChange(-7);
  assert.equal(store.getState().eq[7], -6);
  slider(nodes(), 'Preset amount').props.onSlidingComplete(2); assert.equal(store.getState().amount, 1);
  slider(nodes(), 'Preset amount').props.onSlidingComplete(-1); assert.equal(store.getState().amount, 0);
  slider(nodes(), 'Preset amount').props.onValueChange(NaN); assert.equal(store.getState().amount, 0);
  for (const options of [{ casting: true }, { available: false }, { enhanced: false }]) {
    const blocked = screen(options); await blocked.store.getState().load();
    for (const label of ['Preset amount','EQ 60 Hz','Bass control','Smoothness']) {
      const control = slider(blocked.nodes(), label);
      assert.equal(control.props.disabled, true);
      assert.equal(control.props.accessibilityState.disabled, true);
      control.props.onValueChange(.5); control.props.onSlidingComplete(.5);
    }
    assert.equal(blocked.store.getState().amount, 1);
    assert.equal(blocked.store.getState().eq[0], 0);
    assert.equal(blocked.store.getState().bassControl, 0);
    assert.equal(blocked.store.getState().smoothness, 0);
  }
});

test('Bass control and Smoothness sliders preview live, clear preset selection and save on release', async () => {
  for (const [label, field] of [['Bass control','bassControl'], ['Smoothness','smoothness']]) {
    const storage = secureStorage(); let writes = 0;
    const save = storage.setItemAsync;
    storage.setItemAsync = async (...args) => { writes++; return save(...args); };
    const { store, nodes, configurations, syncEngine } = screen({ storage });
    await store.getState().load(); button(nodes(), 'Resonance Enhance').props.onPress();
    await new Promise(setImmediate); writes = 0;
    slider(nodes(), label).props.onSlidingStart();
    for (const value of [.36,.41,.45]) slider(nodes(), label).props.onValueChange(value);
    syncEngine(); await new Promise(setImmediate);
    assert.equal(configurations.at(-1)[field], .45);
    assert.equal(store.getState().selectedPresetId, null);
    assert.equal(slider(nodes(), label).props.accessibilityValue.text, '45 percent');
    assert.equal(writes, 0);
    slider(nodes(), label).props.onSlidingComplete(.45000002);
    await new Promise(setImmediate);
    assert.equal(writes, 1);
    const restarted = mobileModules({ 'expo-secure-store': storage })('src/store/studioStore.ts').useStudio;
    await restarted.getState().load(); assert.equal(restarted.getState()[field], .45);
    slider(nodes(), label).props.onValueChange(.22);
    await new Promise(setImmediate);
    assert.equal(JSON.parse(storage.values.get('resonance_studio_v1'))[field], .22);
    slider(nodes(), label).props.onSlidingComplete(2); assert.equal(store.getState()[field], 1);
    slider(nodes(), label).props.onSlidingComplete(-1); assert.equal(store.getState()[field], 0);
    slider(nodes(), label).props.onValueChange(NaN); assert.equal(store.getState()[field], 0);
    assert.equal(button(nodes(), `Increase ${label}`), undefined);
    assert.equal(button(nodes(), `Reduce ${label}`), undefined);
  }
});

test('a development client without the native slider shows a rebuild notice without rendering an unavailable view', async () => {
  const { store, nodes } = screen({ slidersAvailable: false });
  await store.getState().load();
  assert.equal(nodes().filter(node => node.type === 'NativeSlider').length, 0);
  assert.ok(text(nodes()[0]).includes('Sliders need an updated native app build'));
  assert.equal(button(nodes(), 'Increase Bass control'), undefined);
  button(nodes(), 'Warm pressing').props.onPress();
  assert.equal(store.getState().enabled, true);
  assert.equal(store.getState().selectedPresetId, 'builtin:Warm pressing');
});

test('every Mastering and Creative slider previews its native parameter, saves on release and preserves module bypass', async () => {
  const { STUDIO_MODULES } = mobileModules()('src/lib/studio.ts');
  for (const group of ['mastering','creative']) {
    const storage = secureStorage(); let writes = 0;
    const save = storage.setItemAsync;
    storage.setItemAsync = async (...args) => { writes++; return save(...args); };
    const { store, nodes, configurations, syncEngine } = screen({ storage });
    await store.getState().load();
    nodes().find(node => node.type === 'Pressable' && text(node) === group.toUpperCase()).props.onPress();
    for (const [index, module] of STUDIO_MODULES.entries()) {
      if (module.group !== group) continue;
      button(nodes(), 'Warm pressing').props.onPress();
      await new Promise(setImmediate); writes = 0;
      const expected = Math.round(module.safe * 50) / 100;
      assert.equal(slider(nodes(), module.title).props.maximumValue, module.safe);
      slider(nodes(), module.title).props.onSlidingStart();
      slider(nodes(), module.title).props.onValueChange(expected);
      syncEngine(); await new Promise(setImmediate);
      assert.equal(configurations.at(-1).values[index], expected, module.title);
      assert.equal(store.getState().selectedPresetId, null, module.title);
      assert.equal(writes, 0, module.title);
      slider(nodes(), module.title).props.onSlidingComplete(expected + .00000001);
      await new Promise(setImmediate);
      assert.equal(writes, 1, module.title);
      assert.equal(JSON.parse(storage.values.get('resonance_studio_v1')).values[index], expected);
      nodes().find(node => node.type === 'Switch' && node.props.accessibilityLabel === `${module.title} enabled`).props.onValueChange(false);
      await new Promise(setImmediate); const writesBeforeDisabled = writes;
      assert.equal(slider(nodes(), module.title).props.disabled, true);
      slider(nodes(), module.title).props.onValueChange(0);
      slider(nodes(), module.title).props.onSlidingComplete(0);
      syncEngine(); await new Promise(setImmediate);
      assert.equal(writes, writesBeforeDisabled);
      assert.equal(configurations.at(-1).values[index], 0);
      assert.equal(store.getState().values[index], expected);
      nodes().find(node => node.type === 'Switch' && node.props.accessibilityLabel === `${module.title} enabled`).props.onValueChange(true);
      assert.equal(slider(nodes(), module.title).props.disabled, false);
      assert.equal(slider(nodes(), module.title).props.value, expected);
      slider(nodes(), module.title).props.onSlidingComplete(1); assert.equal(store.getState().values[index], module.safe);
      slider(nodes(), module.title).props.onSlidingComplete(-1); assert.equal(store.getState().values[index], 0);
      slider(nodes(), module.title).props.onValueChange(NaN); assert.equal(store.getState().values[index], 0);
      assert.equal(button(nodes(), `Increase ${module.title}`), undefined);
      assert.equal(button(nodes(), `Reduce ${module.title}`), undefined);
    }
  }
});

test('effect sliders honour Push it consent, restore controlled limits and disable unavailable playback routes', async () => {
  const { store, nodes, configurations, syncEngine } = screen();
  await store.getState().load();
  nodes().find(node => node.type === 'Pressable' && text(node) === 'MASTERING').props.onPress();
  store.getState().setPushed(true);
  const pushed = slider(nodes(), 'Harmonic exciter');
  assert.equal(pushed.props.maximumValue, 1);
  pushed.props.onSlidingStart(); pushed.props.onValueChange(.8); syncEngine();
  assert.equal(configurations.at(-1).values[0], .8);
  assert.equal(slider(nodes(), 'Harmonic exciter').props.minimumTrackTintColor, 'danger');
  store.getState().setPushed(false);
  pushed.props.onSlidingComplete(.8); // A late release cannot restore an expired range.
  assert.equal(store.getState().values[0], .35);
  assert.equal(slider(nodes(), 'Harmonic exciter').props.maximumValue, .35);
  assert.equal(slider(nodes(), 'Harmonic exciter').props.minimumTrackTintColor, 'accent');
  for (const options of [{ casting: true }, { available: false }]) {
    const blocked = screen(options); await blocked.store.getState().load();
    for (const [tab, label] of [['MASTERING','Harmonic exciter'], ['CREATIVE','Tape flutter']]) {
      blocked.nodes().find(node => node.type === 'Pressable' && text(node) === tab).props.onPress();
      const control = slider(blocked.nodes(), label);
      assert.equal(control.props.disabled, true);
      control.props.onValueChange(.1); control.props.onSlidingComplete(.1);
      assert.ok(blocked.store.getState().values.every(value => value === 0));
    }
  }
});
