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
import { Editorial, Spacing, ThemeColors, Typography } from '../../theme';

import { isMaintenanceResponse } from '../../lib/maintenance';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Switch,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import LoginHero, { loginColors as colors } from '../../components/LoginHero';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { enterLocalMode } from '../../services/appMode';
import RecentServers from '../../components/RecentServers';
import { biometricSignIn, signInToServer } from '../../services/serverSignIn';
import { biometricsAvailable, useServerProfiles } from '../../store/serverProfilesStore';
import { useAuthStore } from '../../store/auth';
import type { TextInput as NativeTextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const serverUrl    = useAuthStore((s) => s.serverUrl)!;
  const clearAll     = useAuthStore((s) => s.clearAll);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const sessionExpired = useAuthStore(state => state.sessionExpired);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [saveBiometric, setSaveBiometric] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [preferPassword, setPreferPassword] = useState(false);
  const passwordRef = useRef<NativeTextInput>(null);
  const profiles = useServerProfiles(state => state.profiles);
  const loadProfiles = useServerProfiles(state => state.load);
  const available = biometricsAvailable();
  const savedProfile = profiles.find(profile => profile.url === serverUrl && (!username || profile.username === username));
  const canUseBiometric = !!savedProfile?.biometric && available;
  const showPassword = preferPassword || !canUseBiometric;
  useEffect(() => { void loadProfiles().catch(() => {}); }, [loadProfiles]);
  useEffect(() => { setPreferPassword(false); setShowOptions(false); }, [serverUrl]);
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

  const handleBiometricLogin = async () => {
    if (loading || !canUseBiometric || !savedProfile) return;
    setLoading(true);
    setError('');
    try { await biometricSignIn(savedProfile.id); }
    catch (e) {
      setPreferPassword(true);
      setError((e as Error).message || 'Use your password to sign in.');
    } finally { setLoading(false); }
  };

  return (
    // KeyboardAwareScrollView, not KeyboardAvoidingView: the latter was passing behavior=undefined
    // on Android, which makes it inert, so the keyboard simply covered the Sign in button.
    <KeyboardAwareScrollView
      bottomOffset={120}
      contentContainerStyle={[s.inner, { paddingBottom: insets.bottom + Spacing.xxl }]}
      keyboardShouldPersistTaps="handled"
      style={s.container}
    >
      <StatusBar style="light" />
      <LoginHero />

      <View style={s.panel}>
        <Text accessibilityRole="header" style={s.title}>{sessionExpired ? 'Sign in again' : 'Welcome back'}</Text>
        {sessionExpired && <Text accessibilityRole="alert" style={s.error}>Your session has expired or was revoked. Sign in again to reconnect. Your saved server and downloaded music are still available.</Text>}
        {showPassword && <Text style={s.sub}>Sign in to your account to continue.</Text>}
        <Text style={s.server}>{serverUrl}</Text>

        <View style={s.form}>
          {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
          {showPassword ? <>
            <View style={s.field}>
              <Text style={s.label}>Username</Text>
              <TextInput
                editable={!loading}
                accessibilityLabel="Username"
                selectionColor={colors.accent}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={value => { setUsername(value); setPreferPassword(true); }}
                onSubmitEditing={() => passwordRef.current?.focus()}
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
                accessibilityLabel="Password"
                ref={passwordRef}
                selectionColor={colors.accent}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={value => { setPassword(value); setPreferPassword(true); }}
                onSubmitEditing={handleLogin}
                placeholder="password"
                placeholderTextColor={colors.textDim}
                returnKeyType="go"
                secureTextEntry
                style={s.input}
                value={password}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={handleLogin}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            >
              {loading
                ? <ActivityIndicator color="#09231e" />
                : <Text style={s.btnText}>Sign in</Text>
              }
            </Pressable>

            {canUseBiometric && <Pressable accessibilityRole="button" disabled={loading} onPress={() => { setPreferPassword(false); setError(''); }} style={s.optionsToggle}>
              <Text style={s.link}>Use biometric sign-in</Text>
            </Pressable>}
          </> : <>
            <Pressable accessibilityRole="button" disabled={loading} onPress={handleBiometricLogin} style={({ pressed }) => [s.btn, s.biometricBtn, pressed && s.btnPressed]}>
              {loading ? <ActivityIndicator color="#09231e" /> : <>
                <Ionicons name="finger-print" size={22} color="#09231e" accessible={false} />
                <Text style={s.btnText}>Sign in with biometrics</Text>
              </>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => setPreferPassword(true)} style={s.optionsToggle}>
              <Text style={s.link}>Use password instead</Text>
            </Pressable>
          </>}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showOptions }}
            accessibilityLabel={showOptions ? 'Fewer sign-in options' : 'More sign-in options'}
            disabled={loading}
            onPress={() => setShowOptions(value => !value)}
            style={s.optionsToggle}
          >
            <Text style={s.optionsLabel}>{showOptions ? 'Fewer sign-in options' : 'More sign-in options'}</Text>
            <Ionicons name={showOptions ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </Pressable>
          {showOptions && <View style={s.options}>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => { void enterLocalMode().catch(() => setError('Could not open local music. Try again.')); }} style={{ paddingVertical: 12 }}><Text style={{ color: colors.accent }}>Use music on this device</Text></Pressable>
            {showPassword && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}><Text style={s.label}>Save this sign-in with Face ID / fingerprint</Text><Text style={{ color: colors.textMuted, fontSize: 11 }}>Optional, for this server on this handset.</Text></View>
              <Switch accessibilityLabel="Save biometric sign-in for this server" disabled={loading || !available} value={saveBiometric} onValueChange={setSaveBiometric} trackColor={{ true: colors.accent, false: colors.bgElevated }} />
            </View>}
            {showPassword && !available && <Text style={{ color: colors.textMuted, fontSize: 11 }}>Set up Face ID or a secure fingerprint on this handset to enable biometric sign-in.</Text>}

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
            <RecentServers colors={colors} disabled={loading} onBusyChange={setLoading} onSelect={async profile => { await useAuthStore.getState().setServerUrl(profile.url); setUsername(profile.username); setPassword(''); setSaveBiometric(false); setPreferPassword(false); setShowOptions(false); }} onForgetCurrent={() => navigation.replace('Connect')} />
            <Text style={s.description}>Resonance is a music streaming app with library management, DJ tools and a Soulseek integration.</Text>
          </View>}
        </View>
        <Text style={s.legal}>
          Built from a modified version of <Text accessibilityRole="link" style={s.legalLink} onPress={() => { void Linking.openURL('https://github.com/slskd/slskd').catch(() => setError('Could not open the link.')); }}>slskd</Text>. Not maintained by, endorsed by, or affiliated with the slskd project or its authors. Licensed under <Text accessibilityRole="link" style={s.legalLink} onPress={() => { void Linking.openURL('https://www.gnu.org/licenses/agpl-3.0.html').catch(() => setError('Could not open the link.')); }}>AGPL-3.0</Text> with <Text accessibilityRole="link" style={s.legalLink} onPress={() => { void Linking.openURL('https://github.com/narey83/resonance/blob/main/LICENSE').catch(() => setError('Could not open the link.')); }}>additional terms</Text>. <Text accessibilityRole="link" style={s.legalLink} onPress={() => { void Linking.openURL('https://github.com/narey83/resonance').catch(() => setError('Could not open the link.')); }}>Source code</Text>.
        </Text>
      </View>
    </KeyboardAwareScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    inner: { flexGrow: 1 },
    panel: { padding: Spacing.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
    title: { fontSize: Typography.xxl, color: c.textPrimary, marginBottom: Spacing.xs, ...Editorial.heading },
    sub:   { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.sm },
    server: { fontSize: Typography.xs, color: c.textMuted, marginBottom: Spacing.md },
    description: { fontSize: Typography.sm, lineHeight: 20, color: c.textMuted, marginTop: Spacing.xl },
    legal: { fontSize: 11, lineHeight: 17, color: '#8eaaaa', borderTopWidth: 1, borderTopColor: c.border, paddingTop: Spacing.md, marginTop: Spacing.md },
    legalLink: { color: c.accent },
    form:  { gap: Spacing.md },
    optionsToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
    optionsLabel: { color: c.textMuted, fontSize: Typography.sm },
    options: { gap: Spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: Spacing.md },
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
      borderRadius: 6,
    },
    error:      { fontSize: Typography.sm, color: c.danger, marginTop: -Spacing.xs },
    btn: { backgroundColor: c.accent, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.xs, ...Editorial.control, borderRadius: 6 },
    btnPressed: { opacity: 0.8 },
    biometricBtn: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, minHeight: 48 },
    scanBtn: {
      alignItems: 'center',
      borderColor: c.border,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
      gap: Spacing.sm,
      justifyContent: 'center',
      marginTop: Spacing.md,
      paddingVertical: Spacing.md,
    },
    scanBtnText: { color: c.accent, fontSize: Typography.base, fontWeight: '600' },
    btnText:    { color: '#09231e', fontSize: Typography.base, fontWeight: '600' },
    link:       { fontSize: Typography.sm, color: c.accent, textAlign: 'center', marginTop: Spacing.xs },
  });
}

const s = makeStyles(colors);
