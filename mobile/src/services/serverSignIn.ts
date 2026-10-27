import * as SecureStore from 'expo-secure-store';
import { tokenUsername } from '../lib/jwt';
import { Platform } from 'react-native';
import { login } from '../api/session';
import { getDeviceId, getDeviceName, useAuthStore } from '../store/auth';
import { useAppMode } from '../store/appModeStore';
import { biometricOptions, biometricsAvailable, credentialKey, normalizeServerUrl, useServerProfiles } from '../store/serverProfilesStore';
import { getSessionGeneration, isCurrentSession } from '../lib/sessionScope';

// Credentials are bound to the canonical server address AND account. Only the OS can
// release the protected item; no plain-text duplicate or JS-only biometric gate exists.
export async function signInToServer(raw: string, username: string, password: string, enableBiometric = false, allowed: () => boolean = () => true): Promise<void> {
  const url = normalizeServerUrl(raw);
  const generation = getSessionGeneration();
  const [deviceName, deviceId] = await Promise.all([getDeviceName(), getDeviceId()]);
  if (!isCurrentSession(generation) || !allowed()) return;
  const existing = useAuthStore.getState();
  const data = await login(url, username, password, deviceName, deviceId, existing.serverUrl === url ? existing.sessionId : null);
  if (!isCurrentSession(generation) || !allowed()) return;
  const account = data.name || tokenUsername(data.token) || username;
  const profiles = useServerProfiles.getState();
  let profile;
  if (enableBiometric) {
    if (!biometricsAvailable()) throw new Error('Set up Face ID or a secure fingerprint on this handset first.');
    profile = await profiles.remember(url, account);
    const options = biometricOptions(url), key = credentialKey(profile.id);
    try {
      await SecureStore.setItemAsync(key, JSON.stringify({ url, username: account, password }), options);
      // iOS does not prompt when creating a new item. Verify the new key once so
      // refusing Face ID or cancelling does not leave biometric sign-in enabled.
      if (Platform.OS === 'ios') {
        const verified = await SecureStore.getItemAsync(key, options);
        if (!verified) throw new Error('Biometric setup was not completed.');
      }
      if (!isCurrentSession(generation) || !allowed()) { await SecureStore.deleteItemAsync(key, options); return; }
      await profiles.setBiometric(profile.id, true);
    } catch {
      await SecureStore.deleteItemAsync(key, options).catch(() => {});
      await profiles.setBiometric(profile.id, false).catch(() => {});
      throw new Error('Biometric setup was cancelled or unavailable. You can still sign in with your password.');
    }
  } else {
    // A history write must not make an otherwise valid password sign-in fail.
    await profiles.remember(url, account).catch(() => {});
  }
  if (!isCurrentSession(generation) || !allowed()) return;
  const savingServer = useAuthStore.getState().setServerUrl(url);
  const current = getSessionGeneration(); await savingServer;
  if (!isCurrentSession(current) || !allowed()) return;
  await useAppMode.getState().select('remote');
  if (!isCurrentSession(current) || !allowed()) return;
  await useAuthStore.getState().setTokens(data.token, data.refreshToken, data.sessionId, { generation: current });
}

export async function biometricSignIn(id: string): Promise<void> {
  const generation = getSessionGeneration();
  const profile = useServerProfiles.getState().profiles.find(p => p.id === id);
  if (!profile?.biometric) throw new Error('Use your password to enable biometric sign-in for this server.');
  if (!biometricsAvailable()) throw new Error('Biometrics are unavailable. Use your password instead.');
  let raw;
  try { raw = await SecureStore.getItemAsync(credentialKey(id), biometricOptions(profile.url)); }
  catch { throw new Error('Biometric sign-in was cancelled or unavailable. Use your password instead.'); }
  if (!isCurrentSession(generation)) return;
  if (!raw) {
    await useServerProfiles.getState().setBiometric(id, false);
    throw new Error('Saved sign-in is no longer available. Sign in with your password and enable biometrics again.');
  }
  let credential;
  try { credential = JSON.parse(raw); } catch { throw new Error('Saved sign-in is invalid. Use your password instead.'); }
  const currentProfile = useServerProfiles.getState().profiles.find(p => p.id === id);
  if (!currentProfile?.biometric || currentProfile.url !== profile.url || currentProfile.username !== profile.username) return;
  if (!credential || credential.url !== profile.url || credential.username !== profile.username || typeof credential.password !== 'string' || !credential.password) throw new Error('Saved sign-in does not match this server. Use your password instead.');
  try { await signInToServer(profile.url, credential.username, credential.password, false, () => {
    const latest = useServerProfiles.getState().profiles.find(p => p.id === id);
    return !!latest?.biometric && latest.url === profile.url && latest.username === profile.username;
  }); }
  catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 401) {
      await useServerProfiles.getState().setBiometric(id, false);
      throw new Error('The saved password is no longer accepted. Sign in with your current password.');
    }
    throw error;
  }
}
