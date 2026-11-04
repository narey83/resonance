const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick, jwt, secureStorage } = require('./helpers.cjs');

function setup(storage = secureStorage()) {
  const load = mobileModules({ 'expo-secure-store': storage, 'react-native': { Platform: { OS: 'android' } } });
  return { load, auth: load('src/store/auth.ts').useAuthStore, storage,
    session: load('src/lib/sessionScope.ts') };
}

test('storage failure finishes startup and permits a successful retry', async () => {
  const storage = secureStorage({ resonance_server_url: 'https://one', resonance_access_token: jwt('alice') });
  const get = storage.getItemAsync;
  storage.getItemAsync = async () => { throw new Error('keychain unavailable'); };
  const { auth } = setup(storage);
  await auth.getState().hydrate();
  assert.equal(auth.getState().isReady, true);
  assert.match(auth.getState().hydrationError, /try again/i);
  assert.equal(auth.getState().accessToken, null);
  storage.getItemAsync = get;
  await auth.getState().hydrate();
  assert.equal(auth.getState().hydrationError, null);
  assert.equal(auth.getState().serverUrl, 'https://one');
  assert.equal(auth.getState().isAdmin, true);
});

test('restoration is idempotent after successful startup and does not interrupt the authenticated UI', async () => {
  const storage = secureStorage({ resonance_server_url: 'https://one', resonance_access_token: jwt('alice'), resonance_refresh_token: 'saved-refresh' });
  const { auth, session } = setup(storage);
  await auth.getState().hydrate();
  const before = auth.getState();
  const generation = session.getSessionGeneration();
  let reads = 0;
  storage.getItemAsync = async () => { reads++; throw new Error('No second storage read expected'); };
  await auth.getState().hydrate();
  assert.equal(reads, 0);
  assert.equal(auth.getState(), before);
  assert.equal(session.getSessionGeneration(), generation);
});

test('credential writes cannot restore a logged-out session or overwrite a new login', async () => {
  const { auth, storage, session } = setup();
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice'), 'alice-refresh', 'alice-session');
  const generation = session.getSessionGeneration();
  const gate = deferred();
  const write = storage.setItemAsync;
  const oldToken = jwt('alice', 123);
  storage.setItemAsync = async (key, value) => {
    if (value === oldToken) await gate.promise;
    return write(key, value);
  };
  const refresh = auth.getState().setTokens(oldToken, 'rotated', undefined, { generation, refresh: true });
  await tick();
  const logout = auth.getState().clearTokens();
  assert.equal(auth.getState().accessToken, null);
  const newToken = jwt('bob');
  const login = auth.getState().setTokens(newToken, 'bob-refresh', 'bob-session');
  gate.resolve();
  await Promise.all([refresh, logout, login]);
  assert.equal(auth.getState().accessToken, newToken);
  assert.equal(storage.values.get('resonance_access_token'), newToken);
  assert.equal(storage.values.get('resonance_refresh_token'), 'bob-refresh');
  await auth.getState().setTokens(jwt('alice'), 'late', 'alice-session', { generation, refresh: true });
  assert.equal(auth.getState().accessToken, newToken);
});

test('changing servers immediately drops old credentials and account state', async () => {
  const { auth, session } = setup();
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice'), 'refresh', 'session');
  let reset = 0;
  session.onSessionReset(() => { reset += 1; });
  await auth.getState().setServerUrl('https://two');
  assert.equal(auth.getState().accessToken, null);
  assert.equal(session.getSessionScope(), null);
  assert.equal(reset, 1);
});

test('refresh preserves the session generation, namespace and session ID', async () => {
  const { auth, session } = setup();
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice'), 'refresh', 'session');
  const generation = session.getSessionGeneration();
  const scope = session.getSessionScope();
  await auth.getState().setTokens(jwt('alice'), 'rotated', undefined, { generation, refresh: true });
  assert.equal(session.getSessionGeneration(), generation);
  assert.equal(session.getSessionScope(), scope);
  assert.equal(auth.getState().sessionId, 'session');
});

test('JWT decoding accepts base64url and UTF-8 account names', () => {
  const { load } = setup();
  const { decodeJwt, accountScope } = load('src/lib/jwt.ts');
  const token = jwt('Zoë 🎵');
  assert.equal(decodeJwt(token).name, 'Zoë 🎵');
  assert.equal(accountScope('https://one/', token), accountScope('https://one', token));
  assert.equal(accountScope('https://one', 'invalid'), null);
  assert.equal(decodeJwt('invalid'), null);
});

test('partial credential-write failure is cleaned up before a new login writes', async () => {
  const { auth, storage } = setup();
  await auth.getState().setServerUrl('https://one');
  const gate = deferred();
  const write = storage.setItemAsync;
  const old = jwt('alice');
  storage.setItemAsync = async (key, value) => {
    if (value === 'alice-refresh') throw new Error('refresh write failed');
    if (value === old) await gate.promise;
    return write(key, value);
  };
  const saving = auth.getState().setTokens(old, 'alice-refresh', 'alice-session');
  const rejected = assert.rejects(saving, /refresh write failed/);
  await tick();
  await tick();
  const bob = jwt('bob');
  const nextLogin = auth.getState().setTokens(bob, 'bob-refresh', 'bob-session');
  gate.resolve();
  await rejected;
  await nextLogin;
  assert.equal(auth.getState().accessToken, bob);
  assert.equal(storage.values.get('resonance_access_token'), bob);
  assert.equal(storage.values.get('resonance_refresh_token'), 'bob-refresh');
});

test('credential deletion failure still signs out the in-memory session', async () => {
  const { auth, storage, session } = setup();
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice'), 'refresh', 'session');
  storage.deleteItemAsync = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(auth.getState().clearTokens(), /storage unavailable/);
  assert.equal(auth.getState().accessToken, null);
  assert.equal(session.getSessionScope(), null);
});

test('CarPlay session restoration migrates session keys for locked-phone use after first unlock', async () => {
  const storage = secureStorage({ resonance_server_url: 'https://one', resonance_access_token: jwt('alice') });
  const writes = [], save = storage.setItemAsync;
  storage.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 7;
  storage.setItemAsync = async (key, value, options) => { writes.push([key, options]); await save(key, value); };
  const { auth } = setup(storage);
  await auth.getState().hydrate();
  assert.equal(auth.getState().hydrationError, null);
  assert.ok(writes.some(([key]) => key === 'resonance_access_token'));
  for (const [, options] of writes) assert.equal(options.keychainAccessible, 7);
});

test('session expiry preserves server identity and a subsequent login clears the notice', async () => {
  const { auth, storage } = setup();
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice'), 'refresh', 'session');
  await auth.getState().expireSession();
  assert.equal(auth.getState().sessionExpired, true);
  assert.equal(auth.getState().serverUrl, 'https://one');
  assert.equal(storage.values.get('resonance_server_url'), 'https://one');
  await auth.getState().setTokens(jwt('alice'), 'new-refresh', 'new-session');
  assert.equal(auth.getState().sessionExpired, false);
});
