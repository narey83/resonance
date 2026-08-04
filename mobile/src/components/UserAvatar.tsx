// <copyright file="UserAvatar.tsx" company="John Narey">
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

// A user's Soulseek profile picture, with a coloured initial standing in until
// (or instead of) it — peers are frequently offline and many set no picture at
// all, so the fallback is the normal case, not an error state. Mounting one
// asks userInfoStore for the profile; see that file for why the fetch is lazy.

import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Radius } from '../theme';
import { useUserInfoStore } from '../store/userInfoStore';

// Deterministic hue per username, so the same person keeps the same colour and
// a list of initials stays scannable instead of being a wall of one grey glyph.
function hue(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) hash = (hash * 31 + username.charCodeAt(i)) % 360;
  return hash;
}

export default function UserAvatar({ username, size = 48 }: { username: string; size?: number }) {
  const picture = useUserInfoStore((s) => s.profiles[username]?.picture);
  const load    = useUserInfoStore((s) => s.load);

  useEffect(() => { load(username); }, [username, load]);

  const shape = { width: size, height: size, borderRadius: Radius.full };

  if (picture) {
    return <Image source={{ uri: `data:image/jpeg;base64,${picture}` }} style={shape} resizeMode="cover" />;
  }

  return (
    <View style={[shape, s.initial, { backgroundColor: `hsl(${hue(username)}, 45%, 38%)` }]}>
      <Text style={[s.initialText, { fontSize: size * 0.4 }]}>
        {(username.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  initial:     { justifyContent: 'center', alignItems: 'center' },
  initialText: { fontWeight: '700', color: '#fff' },
});
