import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { login } from '../../api/session';
import { getDeviceName, useAuthStore } from '../../store/auth';
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
      const deviceName = await getDeviceName();
      const data = await login(serverUrl, username, password, deviceName, sessionId);
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.container}
    >
      <View style={s.inner}>
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

          <Pressable onPress={() => { clearAll(); navigation.replace('Connect'); }}>
            <Text style={s.link}>Change server</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    inner: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
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
    btnText:    { color: '#fff', fontSize: Typography.base, fontWeight: '600' },
    link:       { fontSize: Typography.sm, color: c.accent, textAlign: 'center', marginTop: Spacing.xs },
  });
}
