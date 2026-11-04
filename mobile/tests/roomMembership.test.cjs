const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

function setup() {
  let names = ['music'];
  const room = name => ({ name, isPrivate: false, owner: null, operatorCount: null, operators: null, users: [], messages: [] });
  const load = mobileModules({
    'src/api/rooms.ts': { getJoinedNames: async () => names, getRoom: async name => room(name) },
    'src/api/linkPreview.ts': { prefetchMessagePreviews() {} },
    'src/services/messageAlerts.ts': { dismissMessageAlerts() {} },
    'src/lib/sessionScope.ts': { sessionGuard: () => () => true, onSessionReset() {} },
  });
  const store = load('src/store/roomStore.ts').useRoomStore;
  return { store, names: next => { names = next; } };
}

test('public room membership refreshes tolerate null operator lists', async () => {
  const app = setup();
  await app.store.getState().loadJoined();
  const original = app.store.getState().joined;
  await app.store.getState().loadJoined();
  assert.equal(app.store.getState().joined, original);
  app.names(['music', 'new room']);
  await app.store.getState().loadJoined(true);
  assert.deepEqual(app.store.getState().joined.map(r => r.name), ['music', 'new room']);
  assert.equal(app.store.getState().joined[0], original[0]);
  app.names(['new room']);
  await app.store.getState().loadJoined(true);
  assert.deepEqual(app.store.getState().joined.map(r => r.name), ['new room']);
  app.names([]);
  await app.store.getState().loadJoined(true);
  assert.deepEqual(app.store.getState().joined, []);
});
