const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileModules } = require('./helpers.cjs');

function screen() {
  const state = [], joins = [];
  let hook = 0;
  const load = mobileModules({
    react: { ...React, useMemo: fn => fn(), useCallback: fn => fn,
      useState: initial => { const i = hook++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
    'react-native': { View: 'View', Pressable: 'Pressable', FlatList: 'FlatList', Alert: { alert() {} }, StyleSheet: { create: styles => styles } },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'src/components/Typography.tsx': { Text: 'Text', TextInput: 'TextInput' },
    'src/components/BottomSheet.tsx': { default: 'BottomSheet' },
    'src/theme.ts': { Editorial: {}, Radius: {}, Spacing: {}, Typography: {} },
    'src/context/ThemeContext.ts': { useTheme: () => ({ colors: {} }) },
    'src/hooks/useDeferredEffect.ts': { useDeferredFocusEffect() {} },
    'src/store/roomStore.ts': { useRoomStore: () => ({ joined: [], unread: {}, join: async name => joins.push(name) }) },
  });
  const Screen = load('src/screens/more/RoomsScreen.tsx').default;
  const nodes = () => {
    hook = 0; const result = [];
    const visit = node => { if (!React.isValidElement(node)) return; result.push(node); React.Children.forEach(node.props.children, visit); };
    visit(Screen({ navigation: { navigate() {} } })); return result;
  };
  return { nodes, joins, input: () => nodes().find(n => n.type === 'TextInput') };
}
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : String(node ?? '');
const create = app => app.nodes().find(n => n.type === 'Pressable' && text(n) === 'Create');

test('room creation advertises and enforces the native 24-character limit', () => {
  const app = screen();
  assert.equal(app.input().props.maxLength, 24);
  assert.equal(create(app).props.disabled, true);
  app.input().props.onChangeText('Music');
  assert(app.nodes().some(n => n.type === 'Text' && text(n) === '5/24 characters'));
  assert.equal(create(app).props.disabled, false);
});

test('24-character names can be submitted; empty and overlong names cannot create rooms', async () => {
  const app = screen();
  for (const name of ['', '   ', 'x'.repeat(25)]) {
    app.input().props.onChangeText(name);
    assert.equal(create(app).props.disabled, true);
    await app.input().props.onSubmitEditing();
    assert.deepEqual(app.joins, []);
  }
  app.input().props.onChangeText('x'.repeat(24));
  assert.equal(create(app).props.disabled, false);
  await app.input().props.onSubmitEditing();
  assert.deepEqual(app.joins, ['x'.repeat(24)]);
});
