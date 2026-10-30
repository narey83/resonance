// <copyright file="ScanScreen.tsx" company="John Narey">
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

import { Text } from '../../components/Typography';
import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import { getSessionGeneration, isCurrentSession } from '../../lib/sessionScope';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { AuthStackParamList } from '../../navigation/AuthStack';
import { redeemPairingCode } from '../../api/session';
import { getDeviceId, getDeviceName, useAuthStore } from '../../store/auth';
import { useTheme } from '../../context/ThemeContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'Scan'>;

// What the web UI encodes into the QR. Versioned so an older app can say "update me" rather than
// failing with something unhelpful if the payload ever changes shape.
interface PairingPayload {
  v?: number;
  url?: string;
  code?: string;
}

const parsePayload = (raw: string): PairingPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PairingPayload;
    return parsed?.code && parsed?.url ? parsed : null;
  } catch {
    return null;
  }
};

export default function ScanScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setServerUrl = useAuthStore((st) => st.setServerUrl);
  const setTokens = useAuthStore((st) => st.setTokens);

  // The camera fires this continuously while a code is in frame, so without a latch a single scan
  // would kick off a dozen redemptions — and the code is single-use, so all but the first would
  // fail and report an error over the top of the success.
  const handled = useRef(false);

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (handled.current) return;

      const payload = parsePayload(data);

      if (!payload) {
        // Not ours — keep scanning rather than latching, since the user may just have swept
        // across some other barcode on the way to the screen.
        setError('That is not a Resonance pairing code.');
        return;
      }

      handled.current = true;
      setBusy(true);
      setError(null);

      const started = getSessionGeneration();
      try {
        const serverUrl = payload.url!.replace(/\/+$/, '');
        const [deviceName, deviceId] = await Promise.all([getDeviceName(), getDeviceId()]);
        const tokens = await redeemPairingCode(serverUrl, payload.code!, deviceName, deviceId);

        // Order matters: the server address has to be stored before the tokens, because the app
        // treats "has token and has url" as signed in and will immediately start calling the API.
        if (!isCurrentSession(started)) return;
        const savingServer = setServerUrl(serverUrl);
        const generation = getSessionGeneration();
        await savingServer;
        if (!isCurrentSession(generation)) return;
        await setTokens(tokens.token, tokens.refreshToken, tokens.sessionId ?? null, { generation });
      } catch (redeemError: unknown) {
        const status = (redeemError as { response?: { status?: number } })?.response?.status;
        setError(
          status === 401
            ? 'That code has expired or was already used. Generate a new one.'
            : status === 403
              ? 'Pairing is turned off on that server.'
              : 'Could not reach that server. Check it is the address your phone can use.',
        );
        handled.current = false;
        setBusy(false);
      }
    },
    [setServerUrl, setTokens],
  );

  if (!permission) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={s.centre}>
        <Ionicons color={colors.textMuted} name="camera-outline" size={44} />
        <Text style={s.title}>Camera access needed</Text>
        <Text style={s.body}>
          The camera is used only to read the pairing code shown in Resonance on your computer.
        </Text>
        <Pressable
          onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
          style={s.button}
        >
          <Text style={s.buttonText}>
            {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          </Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} style={s.link}>
          <Text style={s.linkText}>Enter details manually instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : onScanned}
        style={StyleSheet.absoluteFill}
      />

      <View pointerEvents="none" style={s.overlay}>
        <View style={s.reticle} />
        <Text style={s.hint}>
          Point at the code in System → Mobile on your computer
        </Text>
      </View>

      {busy ? (
        <View style={s.busy}>
          <ActivityIndicator color="#fff" />
          <Text style={s.busyText}>Signing in…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable onPress={() => navigation.goBack()} style={s.manual}>
        <Text style={s.manualText}>Enter details manually</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    body: {
      color: c.textMuted,
      fontSize: Typography.base,
      lineHeight: 20,
      marginTop: Spacing.sm,
      textAlign: 'center',
    },
    busy: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.75)',
      borderRadius: Radius.md,
      flexDirection: 'row',
      gap: Spacing.sm,
      left: Spacing.xl,
      padding: Spacing.lg,
      position: 'absolute',
      right: Spacing.xl,
      top: '45%',
    },
    busyText: { color: '#fff', fontSize: Typography.base },
    button: {
      backgroundColor: c.accent,
      marginTop: Spacing.lg,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      ...Editorial.control,
    },
    buttonText: { color: '#fff', fontSize: Typography.base, fontWeight: '600' },
    centre: {
      alignItems: 'center',
      backgroundColor: c.bgPrimary,
      flex: 1,
      justifyContent: 'center',
      padding: Spacing.xl,
    },
    container: { backgroundColor: '#000', flex: 1 },
    error: {
      backgroundColor: c.danger,
      borderRadius: Radius.sm,
      bottom: 96,
      left: Spacing.lg,
      padding: Spacing.md,
      position: 'absolute',
      right: Spacing.lg,
    },
    errorText: { color: '#fff', fontSize: Typography.sm, textAlign: 'center' },
    hint: {
      color: '#fff',
      fontSize: Typography.base,
      marginTop: Spacing.xl,
      paddingHorizontal: Spacing.xl,
      textAlign: 'center',
    },
    link: { marginTop: Spacing.lg },
    linkText: { color: c.accent, fontSize: Typography.base },
    manual: {
      alignItems: 'center',
      bottom: Spacing.xl,
      left: 0,
      position: 'absolute',
      right: 0,
    },
    manualText: { color: '#fff', fontSize: Typography.base, textDecorationLine: 'underline' },
    overlay: { alignItems: 'center', flex: 1, justifyContent: 'center' },
    reticle: {
      borderColor: '#fff',
      borderRadius: Radius.lg,
      borderWidth: 3,
      height: 240,
      width: 240,
    },
    title: {
      color: c.textPrimary,
      fontSize: Typography.lg,
      marginTop: Spacing.md,
      ...Editorial.heading,
    },
  });
}
