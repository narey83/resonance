// <copyright file="DownloadModal.tsx" company="John Narey">
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

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing, Typography } from '../theme';
import type { ThemeColors } from '../theme';

export type DownloadTarget = 'server' | 'device';

export default function DownloadModal({
  visible, label, downloadTarget, onChangeDownloadTarget,
  destination, onChangeDestination, onConfirm, onCancel, downloading,
}: {
  visible: boolean;
  label: string;
  downloadTarget: DownloadTarget;
  onChangeDownloadTarget: (t: DownloadTarget) => void;
  destination: string;
  onChangeDestination: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  downloading: boolean;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel} />
      {/* Bottom sheet with a text field: without this the keyboard covers the input and the
          confirm button outright. RN's own KeyboardAvoidingView is inert on Android. */}
      <KeyboardAvoidingView behavior="padding" style={s.container}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Download</Text>
          <Text style={s.subtitle} numberOfLines={2}>{label}</Text>

          <View style={s.segmentRow}>
            {(['server', 'device'] as const).map(t => (
              <Pressable
                key={t}
                style={[s.segment, downloadTarget === t ? s.segmentActive : s.segmentInactive]}
                onPress={() => onChangeDownloadTarget(t)}
              >
                <Text style={[s.segmentText, downloadTarget === t ? s.segmentTextActive : s.segmentTextInactive]}>
                  {t === 'server' ? 'Server' : 'This device'}
                </Text>
              </Pressable>
            ))}
          </View>

          {downloadTarget === 'server' && (
            <>
              <Text style={s.fieldLabel}>Destination folder</Text>
              <TextInput
                style={s.input}
                value={destination}
                onChangeText={onChangeDestination}
                placeholder="/Music"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <View style={s.buttons}>
            <Pressable style={[s.btn, s.cancelBtn]} onPress={onCancel} disabled={downloading}>
              <Text style={[s.btnText, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, { backgroundColor: colors.accent }, downloading && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={downloading}
            >
              {downloading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[s.btnText, { color: '#fff' }]}>Download</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bgSurface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  title:      { fontSize: Typography.lg, fontWeight: '700', color: c.textPrimary },
  subtitle:   { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.xs },
  fieldLabel: { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', marginTop: Spacing.xs },
  input: {
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: c.textPrimary,
  },
  segmentRow:          { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  segment:             { flex: 1, paddingVertical: Spacing.sm - 2, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1 },
  segmentActive:       { backgroundColor: c.accent, borderColor: c.accent },
  segmentInactive:     { backgroundColor: c.bgElevated, borderColor: c.border },
  segmentText:         { fontSize: Typography.sm, fontWeight: '600' },
  segmentTextActive:   { color: '#fff' },
  segmentTextInactive: { color: c.textMuted },
  buttons:   { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  btn: {
    flex: 1, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', minHeight: 40,
  },
  cancelBtn: { backgroundColor: c.bgElevated },
  btnText:   { fontSize: Typography.base, fontWeight: '600' },
});
