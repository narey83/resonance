const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick, jwt, secureStorage, localRequire } = require('./helpers.cjs');
const axios = localRequire('axios');

async function setup(adapter) {
  const transport = Object.assign(axios.create({ adapter }), { CanceledError: axios.CanceledError });
  const load = mobileModules({ axios: transport, 'expo-secure-store': secureStorage(),
    'react-native': { Platform: { OS: 'android' } } });
  const mode = load('src/store/appModeStore.ts').useAppMode;
  await mode.getState().select('remote');
  const auth = load('src/store/auth.ts').useAuthStore;
  await auth.getState().setServerUrl('https://one');
  await auth.getState().setTokens(jwt('alice', 1), 'alice-refresh', 'alice-session');
  return { auth, mode, client: load('src/api/client.ts'), load };
}
const response = (config, data, status = 200) => ({ config, data, status, statusText: 'OK', headers: {} });
const unauthorized = (config, status = 401) => new axios.AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, {}, response(config, {}, status));

test('concurrent proactive refreshes share one request', async () => {
  const gate = deferred();
  let count = 0;
  const token = jwt('alice');
  const { client, auth } = await setup(async (config) => {
    count += 1;
    await gate.promise;
    return response(config, { token, refreshToken: 'rotated' });
  });
  const first = client.getValidToken();
  const second = client.getValidToken();
  await tick();
  assert.equal(count, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [token, token]);
  assert.equal(auth.getState().refreshToken, 'rotated');
});

test('a successful old refresh cannot undo logout', async () => {
  const gate = deferred();
  const { client, auth } = await setup(async (config) => {
    await gate.promise;
    return response(config, { token: jwt('alice'), refreshToken: 'rotated' });
  });
  const refreshing = client.getValidToken();
  await tick();
  await auth.getState().clearTokens();
  gate.resolve();
  assert.equal(await refreshing, '');
  assert.equal(auth.getState().accessToken, null);
});

test('an old refresh rejection cannot sign out a new account', async () => {
  const gate = deferred();
  const { client, auth } = await setup(async (config) => {
    await gate.promise;
    throw unauthorized(config);
  });
  const refreshing = client.getValidToken();
  await tick();
  await auth.getState().clearTokens();
  const bob = jwt('bob');
  await auth.getState().setTokens(bob, 'bob-refresh', 'bob-session');
  gate.resolve();
  assert.equal(await refreshing, '');
  assert.equal(auth.getState().accessToken, bob);
});

test('a new login gets its own refresh while the old refresh is pending', async () => {
  const gates = [deferred(), deferred()];
  const calls = [];
  const { client, auth } = await setup(async (config) => {
    const index = calls.length;
    calls.push(JSON.parse(config.data).refreshToken);
    await gates[index].promise;
    return response(config, { token: jwt(index ? 'bob' : 'alice'), refreshToken: index ? 'bob-rotated' : 'alice-rotated' });
  });
  const oldRefresh = client.getValidToken();
  await tick();
  await auth.getState().clearTokens();
  await auth.getState().setTokens(jwt('bob', 1), 'bob-refresh', 'bob-session');
  const newRefresh = client.getValidToken();
  await tick();
  assert.deepEqual(calls, ['alice-refresh', 'bob-refresh']);
  gates[0].resolve();
  assert.equal(await oldRefresh, '');
  gates[1].resolve();
  assert.equal(await newRefresh, auth.getState().accessToken);
  assert.equal(auth.getState().refreshToken, 'bob-rotated');
});

for (const outcome of ['success', '401']) {
  test(`an old API ${outcome} response is discarded after switching servers`, async () => {
    const gate = deferred();
    const calls = [];
    const { client, auth } = await setup(async (config) => {
      calls.push(config.baseURL);
      await gate.promise;
      if (outcome === '401') throw unauthorized(config);
      return response(config, { private: 'alice data' });
    });
    const request = client.apiClient.get('/chat');
    const rejected = assert.rejects(request, (error) => axios.isCancel(error));
    await tick();
    await auth.getState().setServerUrl('https://two');
    await auth.getState().setTokens(jwt('bob'), 'bob-refresh', 'bob-session');
    gate.resolve();
    await rejected;
    assert.deepEqual(calls, ['https://one/api/v0']);
    assert.equal(auth.getState().refreshToken, 'bob-refresh');
  });
}

test('a current-session 401 refreshes and retries once with the new token', async () => {
  let attempts = 0;
  let refreshes = 0;
  const token = jwt('alice');
  const { client } = await setup(async (config) => {
    if (config.url.endsWith('/session/refresh')) {
      refreshes += 1;
      return response(config, { token, refreshToken: 'rotated' });
    }
    attempts += 1;
    if (attempts === 1) throw unauthorized(config);
    assert.equal(config.headers.Authorization, `Bearer ${token}`);
    return response(config, { ok: true });
  });
  assert.deepEqual((await client.apiClient.get('/chat')).data, { ok: true });
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
});

test('an old hub token factory never receives the next account token', async () => {
  const { client, auth } = await setup(async () => { throw new Error('no refresh expected'); });
  await auth.getState().setTokens(jwt('alice'), 'alice-refresh', 'alice-session');
  const oldFactory = client.createAccessTokenFactory();
  assert.equal(await oldFactory(), auth.getState().accessToken);
  await auth.getState().setServerUrl('https://two');
  await auth.getState().setTokens(jwt('bob'), 'bob-refresh', 'bob-session');
  assert.equal(await oldFactory(), '');
  assert.equal(await client.createAccessTokenFactory()(), auth.getState().accessToken);
});

for (const modeName of ['choose', 'local']) {
  test(`${modeName} mode blocks API traffic and token refresh with saved credentials`, async () => {
    let requests = 0;
    const { client, mode } = await setup(async config => { requests++; return response(config, {}); });
    await mode.getState().select(modeName);
    assert.equal(await client.getValidToken(), '');
    await assert.rejects(client.apiClient.get('/library'));
    assert.equal(requests, 0);
  });
}

test('a rejected API token without renewal credentials exits to sign-in', async () => {
  const { client, auth } = await setup(async config => { throw unauthorized(config); });
  auth.setState({ refreshToken: null });
  await assert.rejects(client.apiClient.get('/musiclibrary/tracks'));
  assert.equal(auth.getState().accessToken, null);
  assert.equal(auth.getState().sessionExpired, true);
  assert.equal(auth.getState().serverUrl, 'https://one');
});

test('a refreshed token rejected on replay exits instead of leaving the library stuck', async () => {
  let refreshes = 0;
  const { client, auth } = await setup(async config => {
    if (config.url.endsWith('/session/refresh')) { refreshes++; return response(config, { token: jwt('alice'), refreshToken: 'rotated' }); }
    throw unauthorized(config);
  });
  await assert.rejects(client.apiClient.get('/session'));
  assert.equal(refreshes, 1);
  assert.equal(auth.getState().accessToken, null);
  assert.equal(auth.getState().sessionExpired, true);
});

for (const status of [401, 403, 503]) {
  test(`refresh HTTP ${status} ${status === 503 ? 'preserves credentials for retry' : 'shows sign-in again'}`, async () => {
    const { client, auth } = await setup(async config => { throw unauthorized(config, status); });
    await client.getValidToken();
    assert.equal(auth.getState().sessionExpired, status !== 503);
    assert.equal(auth.getState().accessToken === null, status !== 503);
  });
}

test('expired access-only sessions show a reason without waiting for an API request', async () => {
  const { client, auth } = await setup(async () => { throw new Error('No network expected'); });
  auth.setState({ refreshToken: null });
  assert.equal(await client.getValidToken(), '');
  assert.equal(auth.getState().sessionExpired, true);
});

test('a late 401 from a pre-refresh token reuses the current token without rotating again', async () => {
  const gate = deferred();
  let calls = 0;
  const newToken = jwt('alice', Math.floor(Date.now() / 1000) + 7200);
  const { client, auth, load } = await setup(async config => {
    calls++;
    if (calls === 1) { await gate.promise; throw unauthorized(config); }
    assert.equal(config.headers.Authorization, `Bearer ${newToken}`);
    return response(config, { ok: true });
  });
  const pending = client.apiClient.get('/session');
  await tick();
  await auth.getState().setTokens(newToken, 'rotated', undefined, { generation: load('src/lib/sessionScope.ts').getSessionGeneration(), refresh: true });
  gate.resolve();
  assert.deepEqual((await pending).data, { ok: true });
  assert.equal(calls, 2);
  assert.equal(auth.getState().sessionExpired, false);
});
