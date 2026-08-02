// <copyright file="ConnectScreen.tsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
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

import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';

const LOGO_SIZE = 72;

export function ResonanceLogo() {
  const scale   = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <LinearGradient
        colors={['#4f46e5', '#06b6d4']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={logoGradientStyle}
      >
        <Svg fill="none" height={LOGO_SIZE * 0.6} viewBox="0 0 24 24" width={LOGO_SIZE * 0.6}>
          <Circle cx="12" cy="12" r="8" stroke="white" strokeOpacity={0.95} strokeWidth="1.8" />
          <Path
            d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
            stroke="white"
            strokeLinecap="round"
            strokeOpacity={0.95}
            strokeWidth="1.8"
          />
        </Svg>
      </LinearGradient>
    </Animated.View>
  );
}

const logoGradientStyle = {
  width: LOGO_SIZE,
  height: LOGO_SIZE,
  borderRadius: LOGO_SIZE * 0.22,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
