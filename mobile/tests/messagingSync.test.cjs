const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');
function setup() {
  const events = new Map(), timers = new Set(), calls = [];
  let current = true, gate, joinedGate;
  const appState = { currentState: 'active' };
  const chats = { messages: { alice: [] }, loadConversations: async () => { calls.push('inbox'); },
    loadMessages: async (name) => { calls.push(`pm:${name}`); if (gate) await gate.promise; } };
  const rooms = { loadUnread: async () => { calls.push('unread'); }, messages: { music: [] }, loadJoined: async (quiet) => {
    calls.push('joined'); assert.equal(quiet, true);
    const pending = joinedGate; joinedGate = undefined;
    if (pending) await pending.promise;
  },
    loadMessages: async (name) => { calls.push(`room:${name}`); } };
  const load = mobileModules({ 'react-native': { AppState: appState },
    'src/store/conversationStore.ts': { useConversationStore: { getState: () => chats } },
    'src/store/roomStore.ts': { useRoomStore: { getState: () => rooms } },
  }, { setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn) });
  const hub = { on: (event, fn) => events.set(event, fn), off: (event) => events.delete(event) };
  const sync = load('src/services/messagingSync.ts').startMessagingSync(hub, () => current);
  return { sync, calls, events, timers, appState,
    emit: (event, data) => events.get(event)?.(data),
    end: () => { current = false; },
    gate: () => (gate = deferred()),
    joinedGate: () => (joinedGate = deferred()),
    poll: () => { const pending = [...timers]; timers.clear(); pending.forEach((fn) => fn()); },
  };
}
test('room traffic and private changes refresh while unrelated screens are open', async () => {
  const app = setup();
  app.emit('ROOM_MESSAGE', { roomName: 'music' });
  app.emit('CONVERSATION_CHANGED', { username: 'alice' });
  app.emit('PRIVATE_MESSAGE', { username: 'new-peer' });
  await tick();
  assert.ok(app.calls.includes('room:music'));
  assert.ok(app.calls.includes('unread'));
  assert.ok(app.calls.includes('pm:alice'));
  assert.ok(app.calls.includes('inbox'));
  assert.ok(!app.calls.includes('pm:new-peer'));
  app.sync.stop();
});
test('a burst during an in-flight thread fetch is coalesced and fetched again', async () => {
  const app = setup(), gate = app.gate();
  for (let i = 0; i < 10; i++) app.emit('PRIVATE_MESSAGE', { username: 'alice' });
  assert.equal(app.calls.filter((c) => c === 'pm:alice').length, 1);
  gate.resolve(); await tick();
  assert.equal(app.calls.filter((c) => c === 'pm:alice').length, 2);
  app.sync.stop();
});
test('catch-up refreshes both message types; compatibility polling pauses in background', async () => {
  const app = setup();
  app.sync.reconcile(); await tick();
  assert.deepEqual(new Set(app.calls), new Set(['inbox', 'joined', 'pm:alice', 'room:music', 'unread']));
  app.calls.length = 0; app.appState.currentState = 'background'; app.poll(); await tick();
  assert.equal(app.calls.length, 0);
  app.appState.currentState = 'active'; app.poll(); await tick();
  assert.ok(app.calls.includes('room:music'));
  assert.ok(app.calls.includes('unread'));
  app.sync.stop(); assert.equal(app.timers.size, 0);
});
test('signed-out sessions and disposed listeners cannot reload account data', async () => {
  const app = setup(); app.end();
  app.emit('ROOM_MESSAGE', { roomName: 'music' }); app.emit('STATE', { rooms: ['music'] }); app.sync.reconcile(); app.poll();
  await tick(); assert.equal(app.calls.length, 0);
  app.sync.stop(); assert.equal(app.events.size, 0);
});
test('server membership updates refresh immediately for joins, same-count replacements, and leaving all rooms', async () => {
  const app = setup();
  for (const rooms of [['music'], ['music', 'new-room'], ['music', 'other-room'], []]) {
    const before = app.calls.length;
    app.emit('STATE', { rooms });
    assert.equal(app.calls.length, before + 1); // No timer or screen focus required.
    assert.equal(app.calls.at(-1), 'joined');
    await tick();
  }
  app.sync.stop();
  app.emit('STATE', { rooms: ['after-stop'] });
  assert.equal(app.calls.length, 4);
  assert.equal(app.events.size, 0);
});
test('unrelated, reordered, and incomplete state updates do not repeatedly fetch rooms', async () => {
  const app = setup();
  app.emit('STATE', { rooms: ['music', 'new-room'] }); await tick();
  app.emit('STATE', { rooms: ['new-room', 'music'], pendingRestart: true });
  app.emit('STATE', { rooms: ['music', 'new-room', 'music'] });
  for (const state of [undefined, null, {}, { rooms: null }, { rooms: 'music' }, { rooms: [42] }]) app.emit('STATE', state);
  await tick();
  assert.deepEqual(app.calls, ['joined']);
  app.sync.stop();
});
test('membership changes during an outstanding refresh fetch the latest list again', async () => {
  const app = setup(), gate = app.joinedGate();
  app.emit('STATE', { rooms: ['music'] });
  app.emit('STATE', { rooms: ['music', 'new-room'] });
  app.emit('STATE', { rooms: ['new-room'] });
  assert.deepEqual(app.calls, ['joined']);
  gate.resolve(); await tick();
  assert.deepEqual(app.calls, ['joined', 'joined']);
  app.sync.stop();
});
test('a failed membership refresh can recover through compatibility polling', async () => {
  const app = setup(), gate = app.joinedGate();
  app.emit('STATE', { rooms: ['music'] });
  gate.reject(new Error('offline')); await tick();
  app.poll(); await tick();
  assert.equal(app.calls.filter((call) => call === 'joined').length, 2);
  app.sync.stop();
});
