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

import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ResonanceLogo } from '../../components/ResonanceLogo';
import { enterLocalMode } from '../../services/appMode';
import { useTheme } from '../../context/ThemeContext';
import RecentServers from '../../components/RecentServers';
import { normalizeServerUrl } from '../../store/serverProfilesStore';
import { checkInitialized } from '../../api/session';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Connect'>;

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ConnectScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [url, setUrl]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const setServerUrl          = useAuthStore((s) => s.setServerUrl);

  const connectTo = async (serverUrl: string) => {
    setError('');
    setLoading(true);
    try {
      await checkInitialized(serverUrl);
      await setServerUrl(serverUrl);
      navigation.replace('Login');
    } catch {
      setError('Could not reach that address. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    if (loading) return;
    try { void connectTo(normalizeServerUrl(url)); }
    catch { setError('Enter a valid HTTP or HTTPS server address.'); }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      style={s.container}
    >
      <ScrollView
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <ResonanceLogo />
          <Text style={s.logo}>Resonance</Text>
          <Text style={s.tagline}>Connect to your server</Text>
        </View>

        <View style={s.form}>
          <Text style={s.label}>Server address</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUrl}
            onSubmitEditing={handleConnect}
            placeholder="192.168.1.x:5030"
            placeholderTextColor={colors.textDim}
            returnKeyType="go"
            style={s.input}
            value={url}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            disabled={loading}
            onPress={handleConnect}
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>Connect</Text>
            }
          </Pressable>

          {/* Additive, not a replacement: scanning fills in the address AND signs in, but typing
              the address and credentials by hand stays the primary path above. */}
          <Pressable
            disabled={loading}
            onPress={() => navigation.navigate('Scan')}
            style={({ pressed }) => [s.scanBtn, pressed && s.btnPressed]}
          >
            <Ionicons color={colors.accent} name="qr-code-outline" size={17} />
            <Text style={s.scanBtnText}>Scan QR from Resonance</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={loading} style={s.scanBtn} onPress={() => { void enterLocalMode().catch(() => setError('Could not open local music. Try again.')); }}><Text style={s.scanBtnText}>Use music on this device</Text></Pressable>
          <RecentServers disabled={loading} onBusyChange={setLoading} onSelect={profile => connectTo(profile.url)} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    inner:     { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl },

    header:  { alignItems: 'center', marginBottom: Spacing.xxl, gap: Spacing.sm },
    logo:    { fontSize: Typography.xxl, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.5 },
    tagline: { fontSize: Typography.sm, color: c.textMuted },

    form:       { gap: Spacing.sm },
    label:      { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
    input: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      fontSize: Typography.base,
      color: c.textPrimary,
      ...Editorial.control,
    },
    error:      { fontSize: Typography.sm, color: c.danger, marginTop: -Spacing.xs },
    btn: { backgroundColor: c.accent, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.xs, ...Editorial.control },
    btnPressed: { opacity: 0.8 },
    scanBtn: {
      alignItems: 'center',
      borderColor: c.border,
      borderRadius: Radius.sm,
      borderWidth: 1,
      flexDirection: 'row',
      gap: Spacing.sm,
      justifyContent: 'center',
      marginTop: Spacing.md,
      paddingVertical: Spacing.md,
    },
    scanBtnText: { color: c.accent, fontSize: Typography.base, fontWeight: '600' },
    btnText:    { color: '#fff', fontSize: Typography.base, fontWeight: '600' },
  });
}
