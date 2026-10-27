const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, secureStorage, deferred, jwt } = require('./helpers.cjs');

function setup(platform = 'android') {
  const storage = secureStorage();
  const calls = [], writes = [], commits = [];
  let readProtected = null, available = true, loginHandler = async () => ({ token: jwt('alice'), refreshToken: 'refresh', name: 'alice', sessionId: 'session' });
  const secure = {
    ...storage, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    canUseBiometricAuthentication: () => available,
    setItemAsync: async (key, value, options) => { writes.push({ key, value, options }); await storage.setItemAsync(key, value); },
    getItemAsync: async (key, options) => {
      if (options?.requireAuthentication) { calls.push('biometric'); if (readProtected) return readProtected(key); }
      return storage.getItemAsync(key);
    },
  };
  const auth = { serverUrl: 'https://one', accessToken: null, sessionId: null,
    setServerUrl: async url => { if (auth.serverUrl !== url) { auth.serverUrl = url; scope.resetSessionScope(null); } },
    setTokens: async (...args) => { commits.push(args); auth.accessToken = args[0]; },
  };
  const load = mobileModules({
    'expo-secure-store': secure, 'react-native': { Platform: { OS: platform } },
    'src/store/auth.ts': { useAuthStore: { getState: () => auth }, getDeviceId: async () => 'device', getDeviceName: async () => 'phone' },
    'src/store/appModeStore.ts': { useAppMode: { getState: () => ({ select: async mode => calls.push(mode) }) } },
    'src/api/session.ts': { login: async (...args) => { calls.push(['login', ...args]); return loginHandler(...args); } },
  });
  const scope = load('src/lib/sessionScope.ts');
  const profiles = load('src/store/serverProfilesStore.ts');
  const service = load('src/services/serverSignIn.ts');
  return { storage, writes, calls, commits, auth, scope, ...profiles, ...service,
    setRead: fn => { readProtected = fn; }, setAvailable: value => { available = value; }, setLogin: fn => { loginHandler = fn; },
  };
}
const loginCalls = context => context.calls.filter(call => Array.isArray(call) && call[0] === 'login');
async function enrolled(context, url = 'https://one') {
  await context.signInToServer(url, 'alice', 'test-password', true);
  context.calls.length = 0; context.commits.length = 0;
  return context.useServerProfiles.getState().profiles.find(profile => profile.url === url);
}

test('canonical server addresses deduplicate and reject credential-bearing destinations', async () => {
  const c = setup();
  assert.equal(c.normalizeServerUrl(' HTTPS://ONE:443/base/// '), 'https://one/base');
  for (const url of ['https://alice:secret@one', 'https://one?token=secret', 'https://one#fragment', 'ftp://one', '']) assert.throws(() => c.normalizeServerUrl(url));
  const first = await c.useServerProfiles.getState().remember('https://ONE/', 'alice');
  const second = await c.useServerProfiles.getState().remember('https://one', 'alice');
  assert.equal(first.id, second.id); assert.equal(c.useServerProfiles.getState().profiles.length, 1);
  const restarted = mobileModules({ 'expo-secure-store': c.storage })('src/store/serverProfilesStore.ts').useServerProfiles;
  await restarted.getState().load(); assert.equal(restarted.getState().profiles[0].url, 'https://one');
});

test('ordinary sign-in remembers the address without saving a password', async () => {
  const c=setup(); await c.signInToServer('https://one/', 'ALICE', 'test-password');
  assert.equal(c.commits.length,1);
  assert.equal(c.useServerProfiles.getState().profiles[0].username,'alice');
  assert.ok(c.writes.every(write => !write.value.includes('test-password')));
});

for (const platform of ['ios', 'android']) test(`${platform} enrollment protects credentials and biometric sign-in authenticates before server access`, async () => {
  const c=setup(platform), profile=await enrolled(c);
  const secret=c.writes.find(write=>write.options?.requireAuthentication);
  assert.equal(secret.options.keychainService,'resonance-server-biometric-v1');
  assert.equal(secret.options.keychainAccessible,7);
  assert.ok(!c.storage.values.get('resonance_recent_servers_v1').includes('test-password'));
  await c.biometricSignIn(profile.id);
  assert.equal(c.calls[0],'biometric'); assert.equal(loginCalls(c)[0][1],'https://one'); assert.equal(c.commits.length,1);
});

test('cancelled verification cannot contact a server or clear a valid saved sign-in', async () => {
  const c=setup(), profile=await enrolled(c);
  c.setRead(async()=>{throw new Error('cancelled');});
  await assert.rejects(c.biometricSignIn(profile.id),/cancelled/);
  assert.equal(loginCalls(c).length,0); assert.equal(c.commits.length,0);
  assert.equal(c.useServerProfiles.getState().profiles[0].biometric,true);
});

test('changed biometric enrollment invalidates the shortcut and requires password sign-in', async () => {
  const c=setup(), profile=await enrolled(c); c.setRead(async()=>null);
  await assert.rejects(c.biometricSignIn(profile.id),/no longer available/);
  assert.equal(loginCalls(c).length,0); assert.equal(c.useServerProfiles.getState().profiles[0].biometric,false);
  assert.equal(c.storage.values.has(c.credentialKey(profile.id)),false);
});

test('credentials for another host or account are never submitted', async () => {
  for (const credential of [{url:'https://two',username:'alice',password:'secret'},{url:'https://one',username:'bob',password:'secret'}]) {
    const c=setup(), profile=await enrolled(c); c.setRead(async()=>JSON.stringify(credential));
    await assert.rejects(c.biometricSignIn(profile.id),/does not match/); assert.equal(loginCalls(c).length,0);
  }
});

test('signing out during the native prompt discards its late result', async () => {
  const c=setup(), profile=await enrolled(c), gate=deferred(); c.setRead(()=>gate.promise);
  const signingIn=c.biometricSignIn(profile.id); c.scope.resetSessionScope(null);
  gate.resolve(JSON.stringify({url:profile.url,username:'alice',password:'test-password'})); await signingIn;
  assert.equal(loginCalls(c).length,0); assert.equal(c.commits.length,0);
});

test('forgetting a server during an in-flight login prevents session activation and recreation', async () => {
  const c=setup(), profile=await enrolled(c), gate=deferred(), started=deferred();
  c.setLogin(async()=>{started.resolve();return gate.promise;});
  const signingIn=c.biometricSignIn(profile.id); await started.promise;
  await c.useServerProfiles.getState().forget(profile.id);
  gate.resolve({token:jwt('alice'),name:'alice',refreshToken:'new'}); await signingIn;
  assert.equal(c.commits.length,0); assert.equal(c.useServerProfiles.getState().profiles.length,0);
});

test('rejected saved password disables biometrics but a connection failure preserves them', async () => {
  for(const status of [401,503]) {
    const c=setup(), profile=await enrolled(c);
    c.setLogin(async()=>{throw Object.assign(new Error('failed'),{response:{status}});});
    await assert.rejects(c.biometricSignIn(profile.id));
    assert.equal(c.useServerProfiles.getState().profiles[0].biometric,status!==401);
    assert.equal(c.commits.length,0);
  }
});

test('changing accounts or forgetting a server removes its protected password', async () => {
  const c=setup(), profile=await enrolled(c);
  await c.useServerProfiles.getState().remember(profile.url,'bob');
  assert.equal(c.storage.values.has(c.credentialKey(profile.id)),false);
  assert.equal(c.useServerProfiles.getState().profiles[0].biometric,false);
  const second=await enrolled(c,'https://two');
  await c.useServerProfiles.getState().forget(second.id);
  assert.equal(c.storage.values.has(c.credentialKey(second.id)),false);
});

test('cancelled iOS setup leaves no shortcut or password behind', async () => {
  const c=setup('ios'); c.setRead(async()=>{throw new Error('cancelled');});
  await assert.rejects(c.signInToServer('https://one','alice','test-password',true),/cancelled/);
  const profile=c.useServerProfiles.getState().profiles[0];
  assert.equal(profile.biometric,false); assert.equal(c.storage.values.has(c.credentialKey(profile.id)),false); assert.equal(c.commits.length,0);
});

test('unavailable biometrics cannot read protected credentials or contact a server', async () => {
  const c=setup(), profile=await enrolled(c); c.setAvailable(false);
  await assert.rejects(c.biometricSignIn(profile.id),/unavailable/);
  assert.equal(c.calls.length,0); assert.equal(c.commits.length,0);
});


test('mapped ASP.NET username claims are remembered consistently', async () => {
  const c=setup();
  const payload={ 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name':'alice' };
  const token='header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.signature';
  c.setLogin(async()=>({token,refreshToken:'refresh'}));
  await c.signInToServer('https://one','alice','test-password',true);
  assert.equal(c.useServerProfiles.getState().profiles[0].username,'alice');
  assert.equal(c.useServerProfiles.getState().profiles[0].biometric,true);
});


test('older compact ASP.NET username claims can seed recent-server accounts', () => {
  const load=mobileModules();
  const token='header.'+Buffer.from(JSON.stringify({unique_name:'alice'})).toString('base64url')+'.signature';
  assert.equal(load('src/lib/jwt.ts').tokenUsername(token),'alice');
});
