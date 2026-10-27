import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export interface ServerProfile { id: string; url: string; username: string; lastUsed: number; biometric: boolean }
const INDEX = 'resonance_recent_servers_v1';
export const biometricOptions = (url: string): SecureStore.SecureStoreOptions => ({
  requireAuthentication: true, keychainService: 'resonance-server-biometric-v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  authenticationPrompt: `Sign in to ${new URL(url).host}`,
});
export const credentialKey = (id: string) => `resonance_server_biometric_${id}`;
export function normalizeServerUrl(raw: string): string {
  const value = raw.trim();
  const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use an HTTP or HTTPS server address without credentials, query parameters or fragments.');
  return parsed.toString().replace(/\/+$/, '');
}
export function biometricsAvailable(): boolean {
  try { return SecureStore.canUseBiometricAuthentication(); } catch { return false; }
}
interface ProfilesState {
  profiles: ServerProfile[]; loaded: boolean; error: string | null;
  load(): Promise<void>;
  remember(url: string, username?: string): Promise<ServerProfile>;
  setBiometric(id: string, enabled: boolean): Promise<void>;
  forget(id: string): Promise<void>;
}
let pending: Promise<unknown> = Promise.resolve();
let hydration: Promise<void> | null = null;
const serialize = <T>(action: () => Promise<T>): Promise<T> => {
  const next = pending.catch(() => {}).then(action); pending = next; return next;
};
export const useServerProfiles = create<ProfilesState>((set, get) => {
  const save = async (profiles: ServerProfile[]) => {
    await SecureStore.setItemAsync(INDEX, JSON.stringify(profiles));
    set({ profiles, error: null });
  };
  return {
    profiles: [], loaded: false, error: null,
    load: () => {
      if (get().loaded && !get().error) return Promise.resolve();
      if (hydration) return hydration;
      hydration = (async () => {
        try {
          const raw = await SecureStore.getItemAsync(INDEX);
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(parsed)) throw new Error('Invalid server history');
          const seen = new Set<string>();
          const ids = new Set<string>();
          const profiles: ServerProfile[] = [];
          for (const entry of parsed) {
            try {
              if (!entry || typeof entry.id !== 'string' || !/^[a-z\d_-]+$/i.test(entry.id) || typeof entry.username !== 'string') continue;
              const url = normalizeServerUrl(entry.url);
              if (seen.has(url) || ids.has(entry.id)) continue;
              seen.add(url); ids.add(entry.id); profiles.push({ id: entry.id, url, username: entry.username, biometric: entry.biometric === true, lastUsed: Number.isFinite(entry.lastUsed) ? entry.lastUsed : 0 });
            } catch { /* Invalid individual entries cannot become credential destinations. */ }
          }
          set({ profiles, loaded: true, error: null });
        } catch {
          set({ loaded: true, error: 'Could not read recent servers. Please try again.' });
          throw new Error('Could not read recent servers. Please try again.');
        }
      })().finally(() => { hydration = null; });
      return hydration;
    },
    remember: (raw, username) => serialize(async () => {
      await get().load(); const url = normalizeServerUrl(raw);
      const existing = get().profiles.find(p => p.url === url);
      const changedAccount = !!existing && username !== undefined && username !== existing.username;
      if (changedAccount) await SecureStore.deleteItemAsync(credentialKey(existing.id), biometricOptions(url));
      const profile: ServerProfile = { id: existing?.id ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`, url, username: username ?? existing?.username ?? '', lastUsed: Date.now(), biometric: changedAccount ? false : existing?.biometric ?? false };
      await save([profile, ...get().profiles.filter(p => p.url !== url)]);
      return profile;
    }),
    setBiometric: (id, enabled) => serialize(async () => {
      await get().load(); const profile = get().profiles.find(p => p.id === id);
      if (!profile) throw new Error('This server is no longer saved.');
      if (!enabled) await SecureStore.deleteItemAsync(credentialKey(id), biometricOptions(profile.url));
      await save(get().profiles.map(p => p.id === id ? { ...p, biometric: enabled } : p));
    }),
    forget: id => serialize(async () => {
      await get().load(); const profile = get().profiles.find(p => p.id === id);
      if (profile) await SecureStore.deleteItemAsync(credentialKey(id), biometricOptions(profile.url));
      await save(get().profiles.filter(p => p.id !== id));
    }),
  };
});
