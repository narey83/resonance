// <copyright file="LoginHero.tsx" company="John Narey">
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

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from './Typography';
import { ResonanceLogo } from './ResonanceLogo';
import { themes, Typography, type ThemeColors } from '../theme';

export const loginColors: ThemeColors = {
  ...themes.dark,
  bgPrimary: '#0d151f', bgSurface: '#14232c', bgElevated: '#14232c',
  border: '#31434b', borderStrong: '#50666e',
  textPrimary: '#eef6f4', textMuted: '#b0c1c1', textDim: '#82999e',
  accent: '#91d8c7', accentHover: '#afe8db', danger: '#ffb2ae',
};

const ribbons = Array.from({ length: 24 }, (_, index) => {
  const offset = index * 11;
  return `M -200 ${540 + offset} C 140 ${100 + offset}, 300 ${940 - offset}, 610 ${590 - offset * 0.5} S 1050 ${180 + offset}, 1400 ${350 + offset}`;
});

export default function LoginHero() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const progress = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    let mounted = true;
    let changed = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      changed = true;
      setReducedMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted && !changed) setReducedMotion(enabled);
    }).catch(() => {});
    const app = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion || paused || !active || !focused) return;
    const options = { duration: 20000, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false };
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(progress, { ...options, toValue: 1 }),
      Animated.timing(progress, { ...options, toValue: 0 }),
    ]), { resetBeforeIteration: false });
    loop.start();
    return () => loop.stop();
  }, [active, focused, paused, progress, reducedMotion]);

  return (
    <View style={[s.hero, { paddingTop: insets.top + 24 }]}>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice">
          <Defs>
            <RadialGradient id="login-halo" cx="28%" cy="65%" rx="75%" ry="75%">
              <Stop stopColor="#327b71" stopOpacity={0.35} />
              <Stop offset="1" stopColor="#090f19" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="1200" height="1000" fill="url(#login-halo)" />
        </Svg>
        <Animated.View style={[s.ribbon, { transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 4] }) },
          { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '-4deg'] }) },
          { scale: 1.15 },
        ] }]}>
          <Svg width="100%" height="100%" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice">
            <Defs>
              <LinearGradient id="login-mint" x1="0%" y1="100%" x2="100%" y2="0%">
                <Stop stopColor="#87dec7" stopOpacity={0} />
                <Stop offset="0.3" stopColor="#87dec7" />
                <Stop offset="0.65" stopColor="#c3e9ef" />
                <Stop offset="1" stopColor="#9588d9" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {ribbons.map((path, index) => <Path key={path} d={path} fill="none" stroke="url(#login-mint)" strokeWidth={1.2} opacity={0.12 + Math.sin(index / 23 * Math.PI) * 0.5} />)}
          </Svg>
        </Animated.View>
        <Animated.View style={[s.ribbon, { opacity: 0.3, transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-20, -4] }) },
          { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['165deg', '175deg'] }) },
          { scale: 1.15 },
        ] }]}>
          <Svg width="100%" height="100%" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice">
            <Defs>
              <LinearGradient id="login-gold">
                <Stop stopColor="#b4a2ec" stopOpacity={0} />
                <Stop offset="0.45" stopColor="#b4a2ec" />
                <Stop offset="0.75" stopColor="#e7bf8b" />
                <Stop offset="1" stopColor="#e7bf8b" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {ribbons.map(path => <Path key={path} d={path} fill="none" stroke="url(#login-gold)" strokeWidth={0.8} />)}
          </Svg>
        </Animated.View>
        <Svg width="100%" height="100%" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="login-shade" cx="50%" cy="46%" rx="48%" ry="65%">
              <Stop stopColor="#090f19" stopOpacity={0.75} />
              <Stop offset="1" stopColor="#090f19" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="1200" height="1000" fill="url(#login-shade)" />
        </Svg>
      </View>
      <ResonanceLogo size={64} />
      <Text accessibilityRole="header" style={s.title}>Resonance</Text>
      <Text style={s.tagline}>Your music, ready to stream</Text>
      {!reducedMotion && <Pressable
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Play background animation' : 'Pause background animation'}
        onPress={() => setPaused(value => !value)}
        style={s.motion}
      ><Ionicons name={paused ? 'play-outline' : 'pause-outline'} size={16} color="#d0e5e2" /></Pressable>}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: '#090f19', overflow: 'hidden', minHeight: 230, paddingBottom: 32, gap: 12 },
  ribbon: { ...StyleSheet.absoluteFill, top: -30, bottom: -30, left: -40, right: -40 },
  title: { fontFamily: Typography.display, color: '#fff', fontSize: 32, fontWeight: '600', letterSpacing: -1 },
  tagline: { color: '#d0e5e2', fontSize: 14 },
  motion: { position: 'absolute', left: 16, bottom: 12, width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#ffffff24', backgroundColor: '#ffffff08', alignItems: 'center', justifyContent: 'center' },
});
