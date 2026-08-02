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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Network from 'expo-network';
import Svg, { Circle, Path } from 'react-native-svg';
import axios from 'axios';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { checkInitialized } from '../../api/session';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Connect'>;

const PROBE_PORT    = 5030;
const PROBE_TIMEOUT = 800;
const LOGO_SIZE     = 72;

// ── Animated logo ─────────────────────────────────────────────────────────────

function ResonanceLogo() {
  const scale   = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <LinearGradient
        colors={['#4f46e5', '#06b6d4']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={logoGradientStyle}
      >
        <Svg fill="none" height={LOGO_SIZE * 0.6} viewBox="0 0 24 24" width={LOGO_SIZE * 0.6}>
          <Circle cx="12" cy="12" r="8" stroke="white" strokeOpacity={0.95} strokeWidth="1.8" />
          <Path
            d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
            stroke="white"
            strokeLinecap="round"
            strokeOpacity={0.95}
            strokeWidth="1.8"
          />
        </Svg>
      </LinearGradient>
    </Animated.View>
  );
}

const logoGradientStyle = {
  width: LOGO_SIZE,
  height: LOGO_SIZE,
  borderRadius: LOGO_SIZE * 0.22,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

// ── Network scan ──────────────────────────────────────────────────────────────

const probeHost = async (ip: string): Promise<boolean> => {
  try {
    await axios.get(`http://${ip}:${PROBE_PORT}/api/v0/session/initialized`, { timeout: PROBE_TIMEOUT });
    return true;
  } catch {
    return false;
  }
};

const getSubnetPrefix = (ip: string): string | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ConnectScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [url, setUrl]               = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [scanning, setScanning]     = useState(true);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const setServerUrl                = useAuthStore((s) => s.setServerUrl);
  const scanCancelledRef            = useRef(false);

  useEffect(() => {
    scanCancelledRef.current = false;

    const runScan = async () => {
      try {
        const ipInfo = await Network.getIpAddressAsync();
        const prefix = getSubnetPrefix(ipInfo);
        if (!prefix || scanCancelledRef.current) { setScanning(false); return; }

        const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
        const BATCH = 20;

        for (let i = 0; i < hosts.length; i += BATCH) {
          if (scanCancelledRef.current) break;
          const batch = hosts.slice(i, i + BATCH);
          const results = await Promise.all(
            batch.map(async (ip) => {
              const found = await probeHost(ip);
              return found ? `http://${ip}:${PROBE_PORT}` : null;
            }),
          );
          const found = results.filter(Boolean) as string[];
          if (found.length > 0 && !scanCancelledRef.current) {
            setDiscovered((prev) => [...prev, ...found.filter((f) => !prev.includes(f))]);
          }
        }
      } catch {
        // Network unavailable
      } finally {
        if (!scanCancelledRef.current) setScanning(false);
      }
    };

    runScan();
    return () => { scanCancelledRef.current = true; };
  }, []);

  const normalise = (raw: string) => {
    let s = raw.trim().replace(/\/+$/, '');
    if (s && !s.startsWith('http')) s = `http://${s}`;
    return s;
  };

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
    const serverUrl = normalise(url);
    if (!serverUrl) { setError('Enter a server address'); return; }
    connectTo(serverUrl);
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

        {discovered.length > 0 && (
          <View style={s.discoveredList}>
            {discovered.map((addr) => (
              <Pressable
                disabled={loading}
                key={addr}
                onPress={() => connectTo(addr)}
                style={({ pressed }) => [s.discoveredItem, pressed && s.discoveredItemPressed]}
              >
                <Text style={s.discoveredAddr}>{addr}</Text>
                <Text style={s.discoveredAction}>Connect →</Text>
              </Pressable>
            ))}
          </View>
        )}

        {scanning && discovered.length === 0 && (
          <View style={s.scanRow}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={s.scanText}>Scanning network…</Text>
          </View>
        )}

        {(discovered.length > 0 || !scanning) && (
          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerLabel}>or enter manually</Text>
            <View style={s.dividerLine} />
          </View>
        )}

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

    discoveredList: { gap: Spacing.sm, marginBottom: Spacing.md },
    discoveredItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
    },
    discoveredItemPressed: { opacity: 0.75 },
    discoveredAddr:   { fontSize: Typography.base, color: c.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    discoveredAction: { fontSize: Typography.sm, color: c.accent, fontWeight: '500' },

    scanRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginBottom: Spacing.md, paddingVertical: Spacing.sm },
    scanText:     { fontSize: Typography.sm, color: c.textMuted },

    divider:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
    dividerLine:  { flex: 1, height: 1, backgroundColor: c.border },
    dividerLabel: { fontSize: Typography.xs, color: c.textMuted },

    form:       { gap: Spacing.sm },
    label:      { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
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
  });
}
