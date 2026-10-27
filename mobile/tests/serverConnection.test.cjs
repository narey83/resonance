const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');

function setup() {
  const timers = new Set();
  let foreground, close, reconnected;
  let current = true;
  let starts = 0, refreshes = 0, errors = 0, stops = 0;
  let fail = true;
  let gate;
  const hub = {
    state: 'Disconnected',
    start: async () => {
      starts++;
      if (gate) await gate.promise;
      if (fail) throw new Error('offline');
      hub.state = 'Connected';
    },
    stop: async () => { stops++; hub.state = 'Disconnected'; },
    onreconnected: (fn) => { reconnected = fn; },
    onclose: (fn) => { close = fn; },
  };
  const load = mobileModules({
    'react-native': { AppState: { addEventListener: (_, fn) => {
      foreground = fn;
      return { remove: () => { foreground = undefined; } };
    } } },
    '@microsoft/signalr': { HubConnectionState: { Disconnected: 'Disconnected' } },
  }, {
    setTimeout: (fn) => { timers.add(fn); return fn; },
    clearTimeout: (fn) => timers.delete(fn),
  });
  const stop = load('src/lib/serverConnection.ts').maintainServerConnection(
    hub, () => current, () => { refreshes++; }, () => { errors++; },
  );
  return {
    hub, stop, timers,
    resume: () => foreground?.('active'),
    close: () => { hub.state = 'Disconnected'; close(); },
    reconnected: () => reconnected(),
    online: () => { fail = false; },
    endSession: () => { current = false; },
    gate: () => { gate = deferred(); return gate; },
    retry: () => { for (const fn of [...timers]) { timers.delete(fn); fn(); } },
    counts: () => ({ starts, refreshes, errors, stops }),
  };
}

test('initial offline connection retries, reconnects, and reconciles on resume', async () => {
  const app = setup();
  await tick();
  assert.equal(app.counts().errors, 1);
  assert.equal(app.timers.size, 1);
  app.online();
  app.retry();
  await tick();
  assert.equal(app.hub.state, 'Connected');
  app.resume();
  assert.equal(app.counts().refreshes, 2);
  assert.equal(app.counts().starts, 2);
  app.close();
  app.retry();
  await tick();
  assert.equal(app.hub.state, 'Connected');
  app.stop();
  assert.equal(app.timers.size, 0);
});

test('foreground transitions cannot overlap connection attempts', async () => {
  const app = setup();
  await tick();
  app.online();
  const gate = app.gate();
  app.resume();
  app.resume();
  app.retry();
  assert.equal(app.counts().starts, 2);
  app.stop();
  gate.resolve();
  await tick();
  assert.equal(app.hub.state, 'Disconnected');
  assert.equal(app.timers.size, 0);
});

test('an old login cannot reconnect or reconcile after a session change', async () => {
  const app = setup();
  await tick();
  app.endSession();
  app.online();
  app.resume();
  app.retry();
  await tick();
  assert.equal(app.counts().starts, 1);
  assert.equal(app.counts().refreshes, 0);
  app.stop();
});

 test('automatic reconnect reconciles missed messages without changing screens', async () => {
  const app = setup();
  await tick();
  app.online(); app.retry(); await tick();
  const before = app.counts().refreshes;
  app.reconnected();
  assert.equal(app.counts().refreshes, before + 1);
  app.stop(); app.reconnected();
  assert.equal(app.counts().refreshes, before + 1);
});
