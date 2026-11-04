// <copyright file="loginScreen.test.cjs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a music streaming app based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mobileModules } = require('./helpers.cjs');

function screen({ biometric = false, available = true, profileUrl = 'https://resonance.example', biometricError } = {}) {
  const states = [], effects = [], passwordCalls = [], biometricCalls = [];
  const url = 'https://resonance.example';
  const profile = { id: 'saved', url: profileUrl, username: 'listener', biometric };
  const profiles = biometric ? [profile] : [];
  let cursor = 0, effectCursor = 0, dirty = false, loaded = 0;
  const loadProfiles = async () => { loaded++; };
  const auth = { serverUrl: url, sessionExpired: false, clearAll: async () => {} };
  const useAuthStore = selector => selector(auth);
  useAuthStore.getState = () => ({ setServerUrl: async () => {} });
  const colors = { bgPrimary: '#0d151f', bgSurface: '#14232c', accent: '#91d8c7', textMuted: '#b0c1c1' };
  const load = mobileModules({
    react: {
      useRef: () => ({ current: null }),
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => {
          const next = typeof value === 'function' ? value(states[index]) : value;
          if (next !== states[index]) { states[index] = next; dirty = true; }
        }];
      },
      useEffect: (setup, dependencies) => {
        const index = effectCursor++, previous = effects[index];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects[index] = { dependencies, setup };
      },
    },
    'react-native': { View: 'View', Pressable: 'Pressable', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator', Linking: { openURL: async () => {} }, StyleSheet: { create: value => value } },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: 'KeyboardScroll' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'src/components/Typography.tsx': { Text: 'Text', TextInput: 'Input' },
    'src/components/LoginHero.tsx': { __esModule: true, default: 'Hero', loginColors: colors },
    'src/components/RecentServers.tsx': { __esModule: true, default: 'RecentServers' },
    'src/theme.ts': { Editorial: { heading: {}, control: {} }, Typography: { sm: 13, xs: 11, base: 14, xxl: 24 }, Spacing: { xs: 4, sm: 8, md: 12, xl: 20, xxl: 32 } },
    'src/lib/maintenance.ts': { isMaintenanceResponse: () => false },
    'src/services/appMode.ts': { enterLocalMode: async () => {} },
    'src/services/serverSignIn.ts': {
      signInToServer: async (...args) => { passwordCalls.push(args); },
      biometricSignIn: async id => { biometricCalls.push(id); if (biometricError) throw biometricError; },
    },
    'src/store/serverProfilesStore.ts': { biometricsAvailable: () => available, useServerProfiles: selector => selector({ profiles, load: loadProfiles }) },
    'src/store/auth.ts': { useAuthStore },
  });
  const Component = load('src/screens/auth/LoginScreen.tsx').default;
  const render = () => {
    let tree;
    for (let pass = 0; pass < 8; pass++) {
      cursor = 0; effectCursor = 0; dirty = false;
      tree = Component({ navigation: { navigate() {}, replace() {} } });
      for (const effect of effects) if (effect.setup) { const setup = effect.setup; effect.setup = null; setup(); }
      if (!dirty) return tree;
    }
    throw new Error('Login did not settle');
  };
  return { render, passwordCalls, biometricCalls, loaded: () => loaded };
}

function nodes(tree) {
  if (!tree?.props) return [];
  return [tree, ...[tree.props.children].flat().flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree?.props) return '';
  return [tree?.props?.children].flat().map(text).join('');
}
const input = (tree, label) => nodes(tree).find(node => node.type === 'Input' && node.props.accessibilityLabel === label);
const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label);

test('ordinary login stays focused and disclosure preserves credentials and biometric opt-in', async () => {
  const s = screen(); let tree = s.render();
  assert.ok(input(tree, 'Password').props.secureTextEntry);
  assert.equal(nodes(tree).some(node => node.type === 'RecentServers'), false);
  assert.equal(text(tree).includes('Scan QR from Resonance'), false);
  assert.ok(s.loaded() > 0);
  input(tree, 'Username').props.onChangeText('listener');
  input(tree, 'Password').props.onChangeText('test-password');
  button(tree, 'More sign-in options').props.onPress(); tree = s.render();
  assert.equal(text(tree).includes('Scan QR from Resonance'), true);
  assert.equal(text(tree).includes('Use music on this device'), true);
  nodes(tree).find(node => node.type === 'Switch').props.onValueChange(true);
  button(tree, 'Fewer sign-in options').props.onPress(); tree = s.render();
  assert.equal(input(tree, 'Password').props.value, 'test-password');
  await button(tree, 'Sign in').props.onPress();
  assert.deepEqual(s.passwordCalls, [['https://resonance.example', 'listener', 'test-password', true]]);
  assert.deepEqual(s.biometricCalls, []);
});

test('saved biometrics lead without prompting automatically and password stays one tap away', async () => {
  const s = screen({ biometric: true }); let tree = s.render();
  assert.equal(input(tree, 'Password'), undefined);
  assert.deepEqual(s.biometricCalls, []);
  assert.equal(text(tree).includes('Continue as'), false);
  button(tree, 'Use password instead').props.onPress(); tree = s.render();
  assert.equal(input(tree, 'Username').props.value, 'listener');
  button(tree, 'Use biometric sign-in').props.onPress(); tree = s.render();
  await button(tree, 'Sign in with biometrics').props.onPress();
  assert.deepEqual(s.biometricCalls, ['saved']);
  assert.deepEqual(s.passwordCalls, []);
});

test('cancelled or failed biometric verification reveals password login with the error', async () => {
  const s = screen({ biometric: true, biometricError: new Error('Biometric sign-in was cancelled. Use your password instead.') });
  await button(s.render(), 'Sign in with biometrics').props.onPress();
  const tree = s.render();
  assert.ok(input(tree, 'Password'));
  assert.ok(nodes(tree).some(node => node.props.accessibilityRole === 'alert' && text(node).includes('cancelled')));
  assert.equal(button(tree, 'Sign in').props.disabled, false);
  assert.deepEqual(s.passwordCalls, []);
});

test('unavailable biometrics and another server profile both use password login', () => {
  for (const options of [{ biometric: true, available: false }, { biometric: true, profileUrl: 'https://another.example' }]) {
    const s = screen(options), tree = s.render();
    assert.ok(input(tree, 'Password'));
    assert.equal(button(tree, 'Sign in with biometrics'), undefined);
    assert.deepEqual(s.biometricCalls, []);
  }
});

test('changing the account does not offer a different account biometric credential', () => {
  const s = screen({ biometric: true }); let tree = s.render();
  button(tree, 'Use password instead').props.onPress(); tree = s.render();
  input(tree, 'Username').props.onChangeText('someone-else'); tree = s.render();
  assert.equal(button(tree, 'Use biometric sign-in'), undefined);
  assert.deepEqual(s.biometricCalls, []);
});
