const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');

function setup() {
  const disk = new Map([['folders', { data: JSON.stringify(['legacy account']), etag: 'old' }]]);
  const interactions = [];
  const database = {
    execAsync: async () => {},
    getFirstAsync: async (sql, key) => {
      const row = disk.get(key);
      return row && (sql.includes('SELECT 1') ? { one: 1 } : row);
    },
    runAsync: async (sql, ...args) => {
      if (sql.startsWith('INSERT')) disk.set(args[0], { data: args[1], etag: args[2] });
      else for (const key of disk.keys()) if (key.startsWith(args[1])) disk.delete(key);
    },
  };
  const load = mobileModules({
    'react-native': { InteractionManager: { runAfterInteractions: (callback) => interactions.push(callback) } },
    'expo-sqlite': { openDatabaseAsync: async () => database },
    'src/lib/perfProbe.ts': { notePerfBlock: () => {} },
  });
  const session = load('src/lib/sessionScope.ts');
  const cache = load('src/services/libraryCache.ts');
  const flush = async () => { for (const callback of interactions.splice(0)) callback(); await tick(); };
  return { session, cache, disk, database, flush };
}

test('persistent lists and ETags are isolated by account and server', async () => {
  const { cache, session, flush } = setup();
  session.resetSessionScope('server-one:alice');
  assert.equal(await cache.readListCache('folders'), undefined); // Never adopt legacy rows.
  await cache.writeListCache('folders', ['alice folder'], 'alice-etag');
  await flush();
  session.resetSessionScope('server-one:bob');
  assert.equal(await cache.readListCache('folders'), undefined);
  assert.equal(await cache.getListCacheETag('folders'), undefined);
  await cache.writeListCache('folders', ['bob folder'], 'bob-etag');
  await flush();
  session.resetSessionScope('server-two:alice');
  assert.equal(await cache.hasListCache('folders'), false);
  session.resetSessionScope('server-one:alice', true);
  assert.deepEqual(await cache.readListCache('folders'), ['alice folder']);
  assert.equal(await cache.getListCacheETag('folders'), 'alice-etag');
  session.resetSessionScope(null);
  assert.equal(cache.peekListCache('folders'), undefined);
  assert.equal(await cache.readListCache('folders'), undefined);
});

test('a disk read started by an old login cannot repopulate memory', async () => {
  const { cache, session, database } = setup();
  session.resetSessionScope('alice');
  const gate = deferred();
  database.getFirstAsync = () => gate.promise;
  const reading = cache.readListCache('folders');
  await tick();
  session.resetSessionScope('bob');
  gate.resolve({ data: JSON.stringify(['alice folder']), etag: 'alice-etag' });
  assert.equal(await reading, undefined);
  assert.equal(cache.peekListCache('folders'), undefined);
});

test('deferred writes from a previous login are discarded', async () => {
  const { cache, session, disk, flush } = setup();
  session.resetSessionScope('alice');
  await cache.writeListCache('folders', ['alice folder']);
  session.resetSessionScope('bob');
  await flush();
  assert.equal(disk.has('alice:folders'), false);
  assert.equal(cache.peekListCache('folders'), undefined);
});

test('clearing one account cache preserves another account cache', async () => {
  const { cache, session, flush } = setup();
  session.resetSessionScope('alice');
  await cache.writeListCache('folders', ['alice folder']);
  await flush();
  session.resetSessionScope('bob');
  await cache.writeListCache('folders', ['bob folder']);
  await flush();
  await cache.clearListCache();
  assert.equal(await cache.hasListCache('folders'), false);
  session.resetSessionScope('alice');
  assert.deepEqual(await cache.readListCache('folders'), ['alice folder']);
});
