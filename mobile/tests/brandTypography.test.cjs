const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mobileModules } = require('./helpers.cjs');

test('brand typography selects real faces for regular, medium and heavy weights', () => {
  const { brandFont } = mobileModules()('src/lib/brandTypography.ts');
  for (const [weight, expected] of [[undefined, 'Regular'], ['normal', 'Regular'], ['300', 'Regular'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'SemiBold'], ['700', 'Bold'], ['bold', 'Bold'], ['900', 'Bold']]) {
    assert.equal(brandFont({ fontWeight: weight }), `Inter-${expected}`);
  }
  assert.equal(brandFont({ fontFamily: 'Inter-Regular', fontWeight: '600' }), 'Inter-SemiBold');
  assert.equal(brandFont({ fontFamily: 'Outfit-SemiBold', fontWeight: '600' }), 'Outfit-SemiBold');
  assert.equal(brandFont({ fontFamily: 'monospace', fontWeight: '700' }), 'monospace');
  assert.equal(brandFont({ fontFamily: 'Ionicons' }), 'Ionicons');
});

function primitives(loaded = true, inherited = {}) {
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  const load = mobileModules({
    react: {
      createContext: () => ({ Provider: 'FontProvider' }),
      forwardRef: render => render,
      useContext: () => inherited,
      useMemo: fn => fn(),
    },
    'react-native': { Platform: { OS: 'android' }, Text: 'NativeText', TextInput: 'NativeInput', StyleSheet: { flatten } },
    'expo-font': { isLoaded: () => loaded },
  });
  return load('src/components/Typography.tsx');
}

test('text forwards native props and refs, preserves style precedence and nested font inheritance', () => {
  const { Text } = primitives(true, { fontWeight: '500', fontStyle: 'italic' });
  const ref = { current: null };
  const onPress = () => {};
  const provider = Text({ children: 'Track', numberOfLines: 1, allowFontScaling: false, onPress, style: [{ color: 'red', fontWeight: '400' }, { fontWeight: '700' }] }, ref);
  const native = provider.props.children;
  assert.equal(native.type, 'NativeText');
  assert.equal(native.props.ref, ref);
  assert.equal(native.props.onPress, onPress);
  assert.equal(native.props.numberOfLines, 1);
  assert.equal(native.props.allowFontScaling, false);
  assert.deepEqual(native.props.style.at(-1), { fontFamily: 'Inter-Bold', fontWeight: 'normal' });
  assert.equal(provider.props.value.fontWeight, '700');
  assert.equal(provider.props.value.fontStyle, 'italic');
  const nested = Text({ children: 'Nested' }, null);
  assert.equal(nested.props.children.props.style.at(-1).fontFamily, 'Inter-Medium');
});

test('font failure leaves native fallback intact and input focus, callbacks and secure props are preserved', () => {
  const { Text, TextInput } = primitives(false);
  assert.deepEqual(Text({ children: 'Fallback' }, null).props.children.props.style.at(-1), { fontFamily: 'sans-serif' });
  const ref = { current: null };
  const onChangeText = () => {};
  const input = TextInput({ secureTextEntry: true, onChangeText, accessibilityLabel: 'Password', style: { color: 'blue' } }, ref);
  assert.equal(input.props.ref, ref);
  assert.equal(input.props.secureTextEntry, true);
  assert.equal(input.props.onChangeText, onChangeText);
  assert.equal(input.props.accessibilityLabel, 'Password');
  assert.deepEqual(input.props.style.at(-1), { fontFamily: 'sans-serif' });
});
