const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileModules, secureStorage } = require('./helpers.cjs');

function screen({ available = true, casting = false } = {}) {
  const store = mobileModules({ 'expo-secure-store': secureStorage() })('src/store/studioStore.ts').useStudio;
  const { StudioRack } = mobileModules({
    react: { ...React, useState: initial => [initial, () => {}] },
    'react-native': {
      Alert: {}, StyleSheet: { create: styles => styles },
      Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
      Text: 'Text', TextInput: 'TextInput', View: 'View',
    },
    'src/theme.ts': { Editorial: {}, Typography: {} },
    'src/context/ThemeContext.ts': { useTheme: () => ({ colors: { accent: 'accent', borderStrong: 'border', bgElevated: 'elevated' } }) },
    'src/context/CastContext.ts': { useCast: () => ({ isCasting: casting }) },
    'src/native/studio.ts': { studio: { available } },
    'src/store/studioStore.ts': { useStudio: () => store.getState() },
  })('src/screens/more/StudioScreen.tsx');
  const nodes = () => {
    const result = [];
    const visit = node => {
      if (!React.isValidElement(node)) return;
      result.push(node);
      React.Children.forEach(node.props.children, visit);
    };
    visit(StudioRack({}));
    return result;
  };
  return { store, nodes };
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
  assert.ok(content.includes('Harmonic exciter'));
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
