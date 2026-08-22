// <copyright file="LinkPreviewCard.tsx" company="John Narey">
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

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing, Typography } from '../theme';
import type { ThemeColors } from '../theme';
import { getLinkPreview } from '../api/linkPreview';
import type { LinkPreview } from '../api/linkPreview';

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function LinkPreviewCard({ url }: { url: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);

    getLinkPreview(url).then((result) => {
      if (!cancelled) setPreview(result);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview || (!preview.title && !preview.description && !preview.imageUrl)) {
    return null;
  }

  return (
    <Pressable onPress={() => Linking.openURL(url)} style={s.card}>
      {preview.imageUrl ? (
        <Image resizeMode="cover" source={{ uri: preview.imageUrl }} style={s.image} />
      ) : null}
      <View style={s.body}>
        <View style={s.siteRow}>
          <Ionicons color={colors.textMuted} name="globe-outline" size={11} />
          <Text numberOfLines={1} style={s.site}>
            {preview.siteName || hostname(url)}
          </Text>
        </View>
        {preview.title ? (
          <Text numberOfLines={1} style={s.title}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text numberOfLines={2} style={s.desc}>
            {preview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      marginTop: Spacing.xs,
      maxWidth: 260,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
    },
    image: { width: 64, height: 64, backgroundColor: c.bgSurface },
    body: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2, padding: Spacing.sm },
    siteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    site: { fontSize: Typography.xs - 1, color: c.textMuted, textTransform: 'uppercase' },
    title: { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },
    desc: { fontSize: Typography.xs, color: c.textMuted },
  });
}
