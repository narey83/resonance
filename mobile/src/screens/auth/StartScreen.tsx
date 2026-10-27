import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Typography } from '../../theme';
import { useAppMode } from '../../store/appModeStore';
import { enterLocalMode } from '../../services/appMode';

export default function StartScreen() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const modeError = useAppMode(state => state.error);
  const choose = async (local: boolean) => {
    setBusy(true);
    try { if (local) await enterLocalMode(); else await useAppMode.getState().select('remote'); }
    catch (error) { Alert.alert('Could not continue', (error as Error).message); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={[s.screen, { backgroundColor: colors.bgPrimary }]}><View style={s.content}>
    <Text style={[s.wordmark, { color: colors.textPrimary }]}>RESONANCE</Text>
    <View style={[s.rule, { backgroundColor: colors.textPrimary }]} />
    <Text style={[s.title, { color: colors.textPrimary }]}>Where’s your music?</Text>
    <Text style={[s.copy, { color: colors.textMuted }]}>Start with music on this device. Connect to a Resonance server whenever you want.</Text>
    {([{ local: true, icon: 'phone-portrait-outline', title: 'Music on this device', detail: 'Listen to local audio. No account or server needed.' }, { local: false, icon: 'server-outline', title: 'Connect to a server', detail: 'Add your remote library, discovery and community.' }] as const).map(option => <Pressable key={option.title} accessibilityRole="button" disabled={busy} onPress={() => void choose(option.local)} style={({ pressed }) => [s.option, { borderColor: colors.borderStrong, opacity: busy || pressed ? .6 : 1 }]}>
      <Ionicons name={option.icon} size={25} color={colors.accent} /><View style={s.optionText}><Text style={[s.optionTitle, { color: colors.textPrimary }]}>{option.title}</Text><Text style={[s.copy, { color: colors.textMuted }]}>{option.detail}</Text></View><Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
    </Pressable>)}
    {modeError && <Text style={{ color: colors.danger }}>Your choice could not be saved. Try again.</Text>}
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1 }, content: { flex: 1, justifyContent: 'center', padding: 24, gap: 18 }, wordmark: { fontFamily: Typography.display, fontSize: 44, letterSpacing: -1.3 }, rule: { height: 2 }, title: { fontFamily: Typography.display, fontSize: 32, marginTop: 20 }, copy: { fontSize: 13, lineHeight: 20 }, option: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: 18, gap: 14, minHeight: 96 }, optionText: { flex: 1, gap: 6 }, optionTitle: { fontSize: 16, fontWeight: '600' } });
