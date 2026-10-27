import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { ServerProfile, useServerProfiles } from '../store/serverProfilesStore';
import { useAuthStore } from '../store/auth';
import { biometricSignIn } from '../services/serverSignIn';

export default function RecentServers({ onSelect, disabled = false, onBusyChange, onForgetCurrent }: { onSelect(profile: ServerProfile): void | Promise<void>; disabled?: boolean; onBusyChange?(busy: boolean): void; onForgetCurrent?(): void }) {
  const { colors: c } = useTheme();
  const { profiles, error: storageError, load } = useServerProfiles();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void load().catch(() => {}); }, [load]);
  const run = async (action: () => void | Promise<void>) => {
    setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch (e) { setError((e as Error).message || 'Could not connect. Please try again.'); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  const forget = (profile: ServerProfile) => Alert.alert('Forget this server?', 'Remove its saved address and biometric sign-in from this handset. If it is connected, this app will sign out.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget server', style: 'destructive', onPress: () => void run(async () => {
      const auth = useAuthStore.getState();
      // Clear active credentials first so this server cannot be recreated by a late login.
      const current = auth.serverUrl === profile.url;
      if (current) await auth.clearAll();
      await useServerProfiles.getState().forget(profile.id);
      if (current) onForgetCurrent?.();
    }) },
  ]);
  return <View style={{ gap: 12, marginTop: 20 }}>
    <Text style={{ color: c.textMuted, fontSize: 11, letterSpacing: 1 }}>RECENT SERVERS</Text>
    {(error || storageError) && <Text accessibilityRole="alert" style={{ color: c.danger }}>{error || storageError}</Text>}
    {busy && <ActivityIndicator color={c.accent} />}
    {!profiles.length && <Text style={{ color: c.textMuted }}>Servers appear here after you sign in.</Text>}
    {profiles.map(profile => <View key={profile.id} style={{ borderWidth: 1, borderColor: c.borderStrong, padding: 12, gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Connect to ${profile.url}`} disabled={disabled || busy} onPress={() => void run(() => onSelect(profile))} style={{ minHeight: 44, justifyContent: 'center', gap: 4 }}>
        <Text style={{ color: c.textPrimary, fontSize: 14 }}>{profile.url}</Text>
        {!!profile.username && <Text style={{ color: c.textMuted, fontSize: 12 }}>{profile.username}</Text>}
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {profile.biometric && <Pressable accessibilityRole="button" accessibilityLabel={`Biometric sign-in to ${profile.url}`} disabled={disabled || busy} onPress={() => void run(() => biometricSignIn(profile.id))} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><Ionicons name="finger-print" size={21} color={c.accent} /><Text style={{ color: c.accent }}>Biometric sign-in</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Forget ${profile.url}`} disabled={disabled || busy} onPress={() => forget(profile)} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.textMuted }}>Forget</Text></Pressable>
      </View>
    </View>)}
  </View>;
}
