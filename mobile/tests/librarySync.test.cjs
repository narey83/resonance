const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');

function clock() {
  let now = 1000;
  let id = 0;
  const timers = new Map();
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { timers.set(++id, { callback, due: now + delay }); return id; },
    clearTimeout: (key) => { timers.delete(key); },
    size: () => timers.size,
    advance: async (ms) => {
      now += ms;
      for (let count = 0; count < 100; count += 1) {
        const next = [...timers].find(([, timer]) => timer.due <= now);
        if (!next) break;
        timers.delete(next[0]);
        next[1].callback();
        await tick();
      }
    },
  };
}
function setup() {
  const time = clock();
  const saved = new Map();
  const requests = [];
  const fixture = { version: 'v1', scanning: false, get: null };
  const api = {
    get: async (url) => {
      requests.push(url);
      if (fixture.get) return fixture.get(url);
      return { status: 200, headers: {}, data: url.endsWith('/version')
        ? { version: fixture.version }
        : url.endsWith('/tracks') ? { tracks: [], total: 0 } : [] };
    },
  };
  const load = mobileModules({
    'src/api/client.ts': { apiClient: api, getValidToken: async () => 'token' },
    'src/services/libraryCache.ts': {
      hasListCache: async () => true,
      getListCacheETag: async () => undefined,
      readListCache: async (key) => saved.get(key),
      writeListCache: async (key, value) => { saved.set(key, value); },
    },
    'src/api/musicLibrary.ts': { seedCoverSignatures: () => {}, seedTrackSignatures: () => {} },
    'src/api/debugLog.ts': { dbg: () => {} },
    'src/lib/perfProbe.ts': { notePerfBlock: () => {} },
    'src/store/libraryActivityStore.ts': { useLibraryActivityStore: {
      getState: () => ({ syncState: { running: fixture.scanning } }),
    } },
  }, time);
  const session = load('src/lib/sessionScope.ts');
  const store = load('src/store/librarySyncStore.ts').useLibrarySync;
  session.resetSessionScope('alice');
  return { store, session, time, fixture, saved, requests };
}

test('the last update in a cooldown window is eventually synced', async () => {
  const { store, time, fixture, requests } = setup();
  await store.getState().sync(1);
  assert.equal(store.getState().syncedRevision, 1);
  fixture.version = 'v2';
  const count = requests.length;
  await store.getState().sync(2);
  await store.getState().sync(3);
  assert.equal(requests.length, count);
  assert.equal(time.size(), 1); // No lingering per-request cap timers.
  await time.advance(180000);
  assert.equal(store.getState().syncedRevision, 3);
  assert.ok(requests.length > count);
  assert.equal(time.size(), 0);
});

test('deferred sync waits for an active backend scan to finish', async () => {
  const { store, time, fixture, requests } = setup();
  await store.getState().sync(1);
  fixture.version = 'v2';
  await store.getState().sync(2);
  fixture.scanning = true;
  const count = requests.length;
  await time.advance(180000);
  assert.equal(requests.length, count);
  fixture.scanning = false;
  await time.advance(5000);
  assert.equal(store.getState().syncedRevision, 2);
});

test('updates arriving during an in-flight sync are retained', async () => {
  const { store, time, fixture, requests } = setup();
  const gate = deferred();
  fixture.get = async (url) => {
    if (url.endsWith('/version')) await gate.promise;
    return { status: 200, headers: {}, data: url.endsWith('/version')
      ? { version: fixture.version } : url.endsWith('/tracks') ? { tracks: [], total: 0 } : [] };
  };
  const first = store.getState().sync(1);
  await tick();
  await store.getState().sync(2);
  assert.equal(requests.length, 1);
  gate.resolve();
  await first;
  await tick();
  fixture.version = 'v2';
  await time.advance(180000);
  assert.equal(store.getState().syncedRevision, 2);
});

test('logout cancels scheduled work and late sync results', async () => {
  const { store, session, time, fixture, saved, requests } = setup();
  const gate = deferred();
  fixture.get = async () => gate.promise;
  const syncing = store.getState().sync(1);
  await tick();
  session.resetSessionScope(null);
  gate.resolve({ status: 200, headers: {}, data: { version: 'old' } });
  await syncing;
  assert.equal(store.getState().status, 'idle');
  assert.equal(saved.size, 0);
  assert.equal(requests.length, 1);
  assert.equal(time.size(), 0);
});
