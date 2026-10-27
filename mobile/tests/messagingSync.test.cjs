const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');
function setup() {
  const events = new Map(), timers = new Set(), calls = [];
  let current = true, gate;
  const appState = { currentState: 'active' };
  const chats = { messages: { alice: [] }, loadConversations: async () => { calls.push('inbox'); },
    loadMessages: async (name) => { calls.push(`pm:${name}`); if (gate) await gate.promise; } };
  const rooms = { messages: { music: [] }, loadJoined: async () => { calls.push('joined'); },
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
  assert.deepEqual(new Set(app.calls), new Set(['inbox', 'joined', 'pm:alice', 'room:music']));
  app.calls.length = 0; app.appState.currentState = 'background'; app.poll(); await tick();
  assert.equal(app.calls.length, 0);
  app.appState.currentState = 'active'; app.poll(); await tick();
  assert.ok(app.calls.includes('room:music'));
  app.sync.stop(); assert.equal(app.timers.size, 0);
});
test('signed-out sessions and disposed listeners cannot reload account data', async () => {
  const app = setup(); app.end();
  app.emit('ROOM_MESSAGE', { roomName: 'music' }); app.sync.reconcile(); app.poll();
  await tick(); assert.equal(app.calls.length, 0);
  app.sync.stop(); assert.equal(app.events.size, 0);
});
