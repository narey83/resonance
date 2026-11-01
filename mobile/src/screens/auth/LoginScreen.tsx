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

import { Text, TextInput } from '../../components/Typography';
import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import { isMaintenanceResponse } from '../../lib/maintenance';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Switch,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ResonanceLogo } from '../../components/ResonanceLogo';
import { Ionicons } from '@expo/vector-icons';
import { enterLocalMode } from '../../services/appMode';
import { useTheme } from '../../context/ThemeContext';
import RecentServers from '../../components/RecentServers';
import { biometricSignIn, signInToServer } from '../../services/serverSignIn';
import { biometricsAvailable, useServerProfiles } from '../../store/serverProfilesStore';
import { useAuthStore } from '../../store/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const serverUrl    = useAuthStore((s) => s.serverUrl)!;
  const clearAll     = useAuthStore((s) => s.clearAll);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const sessionExpired = useAuthStore(state => state.sessionExpired);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [saveBiometric, setSaveBiometric] = useState(false);
  const profiles = useServerProfiles(state => state.profiles);
  const available = biometricsAvailable();
  const savedProfile = profiles.find(profile => profile.url === serverUrl);
  useEffect(() => {
    const profile = profiles.find(p => p.url === serverUrl);
    if (profile) setUsername(value => value || profile.username);
  }, [profiles, serverUrl]);

  const handleLogin = async () => {
    if (loading) return;
    if (!username || !password) { setError('Username and password are required'); return; }
    setError('');
    setLoading(true);
    try {
      await signInToServer(serverUrl, username, password, saveBiometric);
    } catch (e: any) {
      if (isMaintenanceResponse(e?.response)) {
        setError('This server is being maintained. Try again shortly, or use music on this device.');
      } else if (e?.response?.status === 401) {
        setError('Incorrect username or password');
      } else {
        setError(e?.response ? 'Login failed. Check your connection and try again.' : e?.message || 'Login failed. Check your connection and try again.');
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
        <Text style={s.title}>{sessionExpired ? 'Sign in again' : 'Sign in'}</Text>
        {sessionExpired && <Text accessibilityRole="alert" style={s.error}>Your session has expired or was revoked. Sign in again to reconnect. Your saved server and downloaded music are still available.</Text>}
        <Text style={s.sub}>{serverUrl}</Text>

        <View style={s.form}>
          <Pressable accessibilityRole="button" disabled={loading} onPress={() => { void enterLocalMode().catch(() => setError('Could not open local music. Try again.')); }} style={{ paddingVertical: 12 }}><Text style={{ color: colors.accent }}>Use music on this device</Text></Pressable>
          {savedProfile?.biometric && <Pressable accessibilityRole="button" disabled={loading || !available} onPress={async () => {
            setLoading(true); setError('');
            try { await biometricSignIn(savedProfile.id); }
            catch (e) { setError((e as Error).message || 'Use your password to sign in.'); }
            finally { setLoading(false); }
          }} style={s.scanBtn}><Ionicons name="finger-print" size={20} color={colors.accent} /><Text style={s.scanBtnText}>Sign in with biometrics</Text></Pressable>}
          <View style={s.field}>
            <Text style={s.label}>Username</Text>
            <TextInput
              editable={!loading}
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
              editable={!loading}
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}><Text style={s.label}>Save this sign-in with Face ID / fingerprint</Text><Text style={{ color: colors.textMuted, fontSize: 11 }}>Optional, for this server on this handset.</Text></View>
            <Switch accessibilityLabel="Save biometric sign-in for this server" disabled={loading || !available} value={saveBiometric} onValueChange={setSaveBiometric} trackColor={{ true: colors.accent, false: colors.bgElevated }} />
          </View>
          {!available && <Text style={{ color: colors.textMuted, fontSize: 11 }}>Set up Face ID or a secure fingerprint on this handset to enable biometric sign-in.</Text>}

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

          <Pressable disabled={loading} onPress={() => { void clearAll().then(() => navigation.replace('Connect')).catch(() => setError('Could not change server. Try again.')); }}>
            <Text style={s.link}>Change server</Text>
          </Pressable>
          <RecentServers disabled={loading} onBusyChange={setLoading} onSelect={async profile => { await useAuthStore.getState().setServerUrl(profile.url); setUsername(profile.username); setPassword(''); setSaveBiometric(false); }} onForgetCurrent={() => navigation.replace('Connect')} />
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
    logo:    { fontFamily: Typography.display, color: c.textPrimary, fontSize: Typography.xxl, fontWeight: '600', letterSpacing: -0.5 },
    title: { fontSize: Typography.xxl, color: c.textPrimary, marginBottom: Spacing.xs, ...Editorial.heading },
    sub:   { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.xxl },
    form:  { gap: Spacing.md },
    field: { gap: Spacing.xs },
    label: { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
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
    link:       { fontSize: Typography.sm, color: c.accent, textAlign: 'center', marginTop: Spacing.xs },
  });
}
