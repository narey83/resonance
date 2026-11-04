// <copyright file="loginHero.test.cjs" company="John Narey">
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
const { deferred, mobileModules, tick } = require('./helpers.cjs');

function hero() {
  const query = deferred(), states = [], effects = [], loops = [], timings = [];
  const listeners = {};
  let stateIndex = 0, effectIndex = 0, focused = true, removed = 0;
  const progress = { interpolate: options => options };
  const load = mobileModules({
    react: {
      useRef: () => ({ current: progress }),
      useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect: (setup, dependencies) => {
        const index = effectIndex++, previous = effects[index];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          previous?.cleanup?.();
          effects[index] = { dependencies, setup };
        }
      },
    },
    'react-native': {
      View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value, absoluteFill: {} },
      AccessibilityInfo: {
        isReduceMotionEnabled: () => query.promise,
        addEventListener: (_, listener) => { listeners.motion = listener; return { remove: () => { removed++; } }; },
      },
      AppState: {
        currentState: 'active',
        addEventListener: (_, listener) => { listeners.app = listener; return { remove: () => { removed++; } }; },
      },
      Easing: { sin: 'sin', inOut: value => value },
      Animated: {
        Value: function () { return progress; }, View: 'AnimatedView',
        timing: (_, options) => { timings.push(options); return options; }, sequence: value => value,
        loop: () => { const loop = { running: false, start() { this.running = true; }, stop() { this.running = false; } }; loops.push(loop); return loop; },
      },
    },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Path: 'Path', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' },
    'src/components/Typography.tsx': { Text: 'Text' },
    'src/components/ResonanceLogo.tsx': { ResonanceLogo: 'Logo' },
    'src/theme.ts': { themes: { dark: {} }, Typography: { display: 'Outfit' } },
  });
  const Component = load('src/components/LoginHero.tsx').default;
  const render = () => {
    stateIndex = 0; effectIndex = 0;
    const tree = Component();
    for (const effect of effects) if (effect.setup) { effect.cleanup = effect.setup(); effect.setup = null; }
    return tree;
  };
  const unmount = () => effects.forEach(effect => effect.cleanup?.());
  return { query, render, loops, timings, listeners, unmount, focus: value => { focused = value; }, removed: () => removed };
}

function button(tree) {
  if (tree?.props?.accessibilityRole === 'button') return tree;
  for (const child of [tree?.props?.children].flat()) {
    const found = child && button(child);
    if (found) return found;
  }
}

test('login animation waits for motion preference, supports pause, and uses nonblocking native transforms', async () => {
  const h = hero();
  assert.equal(button(h.render()), undefined);
  assert.equal(h.loops.length, 0);
  h.query.resolve(false); await tick();
  let tree = h.render();
  assert.equal(h.loops.at(-1).running, true);
  assert.ok(h.timings.every(options => options.useNativeDriver && options.isInteraction === false));
  button(tree).props.onPress(); tree = h.render();
  assert.equal(h.loops.at(-1).running, false);
  assert.equal(button(tree).props.accessibilityLabel, 'Play background animation');
  button(tree).props.onPress(); h.render();
  assert.equal(h.loops.at(-1).running, true);
  h.unmount();
  assert.equal(h.loops.at(-1).running, false);
});

test('backgrounding, leaving the screen and reduced-motion changes stop the animation', async () => {
  const h = hero(); h.render(); h.query.resolve(false); await tick(); h.render();
  h.listeners.app('background'); h.render();
  assert.equal(h.loops.at(-1).running, false);
  h.listeners.app('active'); h.render();
  assert.equal(h.loops.at(-1).running, true);
  h.focus(false); h.render();
  assert.equal(h.loops.at(-1).running, false);
  h.focus(true); h.render();
  assert.equal(h.loops.at(-1).running, true);
  h.listeners.motion(true); h.render();
  assert.equal(h.loops.at(-1).running, false);
  h.unmount(); assert.equal(h.removed(), 2);
});

test('a late preference query cannot override a newer accessibility event', async () => {
  const h = hero(); h.render(); h.listeners.motion(true);
  h.query.resolve(false); await tick();
  assert.equal(button(h.render()), undefined);
  assert.equal(h.loops.length, 0);
  h.unmount();
});
