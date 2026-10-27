import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useAuthStore } from '../../store/auth';
import { useAppMode } from '../../store/appModeStore';
import { biometricsAvailable, ServerProfile, useServerProfiles } from '../../store/serverProfilesStore';
import { signInToServer } from '../../services/serverSignIn';
import { tokenUsername } from '../../lib/jwt';
import RecentServers from '../../components/RecentServers';

export default function ServersScreen() {
  const { colors: c } = useTheme();
  const { serverUrl, accessToken } = useAuthStore();
  const profiles = useServerProfiles(s => s.profiles);
  const profile = profiles.find(p => p.url === serverUrl);
  const [username, setUsername] = useState(tokenUsername(accessToken) ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const available = biometricsAvailable();
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message || 'Please try again.'); }
    finally { setBusy(false); }
  };
  const choose = async (recent?: ServerProfile) => {
    if (recent) await useAuthStore.getState().setServerUrl(recent.url);
    // Switching to the same server should still lead to its sign-in screen.
    await useAuthStore.getState().clearTokens();
    if (!recent) await useAuthStore.getState().clearAll();
    await useAppMode.getState().select('remote');
  };
  const button = { borderWidth: 1, borderColor: c.borderStrong, padding: 14, minHeight: 48 };
  const input = { borderBottomWidth: 1, borderColor: c.borderStrong, paddingVertical: 12, color: c.textPrimary };
  return <ScrollView style={{ backgroundColor: c.bgPrimary }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
    <Text style={{ fontSize: 24, color: c.textPrimary }}>Your servers</Text>
    {serverUrl && <Text style={{ color: c.textMuted }}>Connected to {serverUrl}</Text>}
    {error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text> : null}
    {busy && <ActivityIndicator color={c.accent} />}
    {profile?.biometric ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => useServerProfiles.getState().setBiometric(profile.id, false))} style={button}><Text style={{ color: c.accent }}>Disable biometric sign-in for this server</Text></Pressable> : <Pressable accessibilityRole="button" disabled={busy || !available} onPress={() => setSetup(!setup)} style={button}><Text style={{ color: available ? c.accent : c.textMuted }}>Enable biometric sign-in for this server</Text></Pressable>}
    {!available && <Text style={{ color: c.textMuted }}>Set up Face ID or a secure fingerprint in your handset settings to use biometric sign-in.</Text>}
    {setup && !profile?.biometric && <View style={{ gap: 12 }}>
      <Text style={{ color: c.textMuted }}>Confirm your server credentials. This sign-in will be saved behind Face ID or fingerprint verification on this handset.</Text>
      <TextInput accessibilityLabel="Server username" autoCapitalize="none" autoCorrect={false} placeholder="Username" placeholderTextColor={c.textMuted} value={username} onChangeText={setUsername} style={input} editable={!busy} />
      <TextInput accessibilityLabel="Server password" autoCapitalize="none" autoCorrect={false} placeholder="Password" placeholderTextColor={c.textMuted} secureTextEntry value={password} onChangeText={setPassword} style={input} editable={!busy} />
      <Pressable accessibilityRole="button" disabled={busy || !username || !password || !serverUrl} onPress={() => void run(async () => { await signInToServer(serverUrl!, username, password, true); setPassword(''); setSetup(false); })} style={button}><Text style={{ color: c.accent }}>Save biometric sign-in</Text></Pressable>
    </View>}
    <RecentServers disabled={busy} onBusyChange={setBusy} onSelect={choose} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => choose())} style={button}><Text style={{ color: c.accent }}>Add another server</Text></Pressable>
  </ScrollView>;
}
