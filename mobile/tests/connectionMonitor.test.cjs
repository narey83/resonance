const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');

function monitor({ native = async () => ({ isConnected: true, type: 'wifi' }), get = async () => ({ data: true }), mode = 'remote' } = {}) {
  let clock = 1000, next = 0, effectCleanup, active, networkListener, url = 'https://first.test', refreshes = 0;
  const timers = new Map(), calls = [], removed = [];
  const set = (callback, delay) => { const id = ++next; timers.set(id, { callback, at: clock + delay }); return id; };
  const clear = id => timers.delete(id);
  const load = mobileModules({
    react: { useEffect: callback => { effectCleanup = callback(); } },
    'react-native': { AppState: { addEventListener: (_, callback) => { active = callback; return { remove: () => removed.push('app') }; } } },
    axios: { get: (...args) => { calls.push(args); return get(...args); } },
    'expo-network': { getNetworkStateAsync: native, NetworkStateType: { CELLULAR: 'cellular' }, addNetworkStateListener: callback => { networkListener = callback; return { remove: () => removed.push('network') }; } },
    zustand: { create: init => { let state; const use = selector => selector(state); use.getState = () => state; state = init(update => Object.assign(state, update)); return use; } },
    'src/store/auth.ts': { useAuthStore: select => select({ serverUrl: url }) },
    'src/store/appModeStore.ts': { useAppMode: select => select({ mode }) },
    'src/api/client.ts': { getValidToken: async () => { refreshes++; return 'valid'; } },
    'src/api/remoteLogger.ts': { remoteLog: () => {} },
  }, { setTimeout: set, clearTimeout: clear, Date: { now: () => clock } });
  const api = load('src/services/connectionMonitor.ts');
  const advance = async ms => {
    const until = clock + ms;
    for (;;) {
      const entry = [...timers].filter(([, value]) => value.at <= until).sort((a,b) => a[1].at-b[1].at)[0];
      if (!entry) break;
      clock = entry[1].at; timers.delete(entry[0]); entry[1].callback(); await tick();
    }
    clock = until; await tick();
  };
  return { start: () => api.useConnectionMonitor(), stop: () => effectCleanup?.(), foreground: () => active('active'),
    changeUrl: value => { url = value; }, calls, advance, removed, status: () => api.useConnectionStore.getState().status,
    refreshes: () => refreshes, network: state => networkListener(state), settle: tick };
}

test('native network rejection cannot permanently stop the HTTP poll', async () => {
  const m = monitor({ native: async () => { throw new Error('network switch'); } });
  m.start(); await m.settle(); await m.advance(3000);
  assert.equal(m.status(), 'connected'); assert.equal(m.calls.length, 1);
  await m.advance(12000); assert.equal(m.calls.length, 2); m.stop();
});

test('a stalled native lookup times out and the server still gets probed', async () => {
  const m = monitor({ native: () => new Promise(() => {}) });
  m.start(); await m.advance(5500);
  assert.equal(m.calls.length, 1); assert.equal(m.status(), 'connected'); m.stop();
});

test('foreground entry clears maintenance immediately without waiting for a suspended timer', async () => {
  let maintenance = true;
  const m = monitor({ get: async () => { if (maintenance) throw { response: { status: 503, data: { code: 'maintenance' } } }; return { data: true }; } });
  m.start(); await m.settle(); await m.advance(3000); assert.equal(m.status(), 'maintenance');
  maintenance = false; m.foreground(); await m.settle();
  assert.equal(m.status(), 'connected'); assert.equal(m.refreshes(), 1); m.stop();
});

test('an obsolete request cannot overwrite the new server or resurrect stopped polling', async () => {
  const old = deferred(); let first = true;
  const m = monitor({ get: () => { if (first) { first = false; return old.promise; } return Promise.resolve({ data: true }); } });
  m.start(); await m.settle(); await m.advance(3000);
  const signal = m.calls[0][1].signal; m.stop(); assert.equal(signal.aborted, true);
  m.changeUrl('https://second.test'); m.start(); await m.settle(); await m.advance(3000);
  old.reject({ response: { status: 503, data: { code: 'maintenance' } } }); await m.settle();
  assert.equal(m.status(), 'connected'); assert.match(m.calls[1][0], /second.test/);
  const count = m.calls.length; m.stop(); await m.advance(30000); assert.equal(m.calls.length, count);
});

test('local-only mode creates no listeners and never contacts a server', async () => {
  const m = monitor({ mode: 'local' }); m.start(); await m.advance(30000);
  assert.equal(m.calls.length, 0); assert.deepEqual(m.removed, []);
});
