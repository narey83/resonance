// <copyright file="LoginScreen.tsx" company="John Narey">
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

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ResonanceLogo } from '../../components/ResonanceLogo';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { login } from '../../api/session';
import { getDeviceId, getDeviceName, useAuthStore } from '../../store/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const serverUrl    = useAuthStore((s) => s.serverUrl)!;
  const setTokens    = useAuthStore((s) => s.setTokens);
  const clearAll     = useAuthStore((s) => s.clearAll);
  const sessionId    = useAuthStore((s) => s.sessionId);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { setError('Username and password are required'); return; }
    setError('');
    setLoading(true);
    try {
      const [deviceName, deviceId] = await Promise.all([getDeviceName(), getDeviceId()]);
      const data = await login(serverUrl, username, password, deviceName, deviceId, sessionId);
      await setTokens(data.token, data.refreshToken, data.sessionId);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        setError('Incorrect username or password');
      } else {
        setError('Login failed. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    // KeyboardAwareScrollView, not KeyboardAvoidingView: the latter was passing behavior=undefined
    // on Android, which makes it inert, so the keyboard simply covered the Sign in button.
    <KeyboardAwareScrollView
      bottomOffset={120}
      contentContainerStyle={s.inner}
      keyboardShouldPersistTaps="handled"
      style={s.container}
    >
      <View style={s.header}>
        <ResonanceLogo />
        <Text style={s.logo}>Resonance</Text>
      </View>

      <View>
        <Text style={s.title}>Sign in</Text>
        <Text style={s.sub}>{serverUrl}</Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>Username</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setUsername}
              onSubmitEditing={() => {}}
              placeholder="username"
              placeholderTextColor={colors.textDim}
              returnKeyType="next"
              style={s.input}
              value={username}
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              placeholder="password"
              placeholderTextColor={colors.textDim}
              returnKeyType="go"
              secureTextEntry
              style={s.input}
              value={password}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            disabled={loading}
            onPress={handleLogin}
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>Sign in</Text>
            }
          </Pressable>

          {/* Also here, not just on Connect. With a server address already stored, signing out
              lands straight on this screen and Connect is never shown — so putting the scanner
              only there made it unreachable for exactly the people who'd already set the app up. */}
          <Pressable
            disabled={loading}
            onPress={() => navigation.navigate('Scan')}
            style={({ pressed }) => [s.scanBtn, pressed && s.btnPressed]}
          >
            <Ionicons color={colors.accent} name="qr-code-outline" size={17} />
            <Text style={s.scanBtnText}>Scan QR from Resonance</Text>
          </Pressable>

          <Pressable onPress={() => { clearAll(); navigation.replace('Connect'); }}>
            <Text style={s.link}>Change server</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAwareScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    inner: { flexGrow: 1, paddingBottom: Spacing.xxl, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxl * 2 },
    header:  { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xxl },
    logo:    { color: c.textPrimary, fontSize: Typography.xxl, fontWeight: '700', letterSpacing: -0.5 },
    title: { fontSize: Typography.xxl, fontWeight: '700', color: c.textPrimary, marginBottom: Spacing.xs },
    sub:   { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.xxl },
    form:  { gap: Spacing.md },
    field: { gap: Spacing.xs },
    label: { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
    input: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      fontSize: Typography.base,
      color: c.textPrimary,
    },
    error:      { fontSize: Typography.sm, color: c.danger, marginTop: -Spacing.xs },
    btn:        { backgroundColor: c.accent, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.xs },
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
    link:       { fontSize: Typography.sm, color: c.accent, textAlign: 'center', marginTop: Spacing.xs },
  });
}
