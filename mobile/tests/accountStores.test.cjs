const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');

function setup(mocks) {
  const load = mobileModules(mocks);
  const session = load('src/lib/sessionScope.ts');
  session.resetSessionScope('alice');
  return { load, session };
}

test('late chat responses do not repopulate a signed-out account', async () => {
  const gate = deferred();
  const { load, session } = setup({ 'src/api/chat.ts': { getMessages: () => gate.promise } });
  const store = load('src/store/conversationStore.ts').useConversationStore;
  store.setState({ conversations: [{ username: 'peer' }], totalUnread: 4 });
  const loading = store.getState().loadMessages('peer');
  session.resetSessionScope('bob');
  gate.resolve([{ message: 'private alice text' }]);
  await loading;
  assert.deepEqual(store.getState().messages, {});
  assert.deepEqual(store.getState().conversations, []);
  assert.equal(store.getState().totalUnread, 0);
});

test('transfer polls cannot repopulate a new login with old data', async () => {
  const gate = deferred();
  const { load, session } = setup({ 'src/api/transfers.ts': { getAll: () => gate.promise } });
  const store = load('src/store/transferStore.ts').useTransferStore;
  const loading = store.getState().loadDownloads();
  session.resetSessionScope('bob');
  gate.resolve([{ id: 'alice-transfer' }]);
  await loading;
  assert.deepEqual(store.getState().downloads, []);
  assert.equal(store.getState().downloadsLoaded, false);
});

test('transfer updates preserve unchanged rows while reflecting retries and ordering', async () => {
  const a = { id: 'a', stateDescription: 'Queued', bytesTransferred: 0, averageSpeed: 0, placeInQueue: 1, attempts: 0 };
  const b = { ...a, id: 'b' };
  let fresh = [a, b];
  const { load } = setup({ 'src/api/transfers.ts': { getAll: async () => fresh } });
  const store = load('src/store/transferStore.ts').useTransferStore;
  await store.getState().loadDownloads();
  const initial = store.getState().downloads;
  fresh = [{ ...b }, { ...a }];
  await store.getState().loadDownloads();
  assert.deepEqual(store.getState().downloads.map((row) => row.id), ['b', 'a']);
  assert.equal(store.getState().downloads[0], initial[1]);
  fresh = [{ ...b, attempts: 1 }, { ...a }];
  await store.getState().loadDownloads();
  assert.equal(store.getState().downloads[0].attempts, 1);
  assert.equal(store.getState().downloads[1], initial[0]);
});

test('room membership and message changes are visible even when counts stay the same', async () => {
  let room = { name: 'music', isPrivate: false, owner: null, operatorCount: 0, operators: [],
    users: [{ username: 'alice' }], messages: [{ message: 'first' }] };
  const { load } = setup({ 'src/api/rooms.ts': {
    getJoinedNames: async () => ['music'], getRoom: async () => room,
  } });
  const store = load('src/store/roomStore.ts').useRoomStore;
  await store.getState().loadJoined();
  const initial = store.getState().joined;
  room = { ...room, users: [{ username: 'bob' }], messages: [{ message: 'second' }] };
  await store.getState().loadJoined();
  assert.notEqual(store.getState().joined, initial);
  assert.equal(store.getState().joined[0].users[0].username, 'bob');
  assert.equal(store.getState().joined[0].messages[0].message, 'second');
  const updated = store.getState().joined;
  room = { ...room, users: [{ username: 'bob' }], messages: [{ message: 'second' }] };
  await store.getState().loadJoined();
  assert.equal(store.getState().joined, updated);
});

test('peer profile requests are invalidated by reset', async () => {
  const gate = deferred();
  const { load, session } = setup({ 'src/api/users.ts': { getUserInfo: () => gate.promise } });
  const store = load('src/store/userInfoStore.ts').useUserInfoStore;
  store.getState().load('peer');
  session.resetSessionScope('bob');
  gate.resolve({ hasPicture: true, picture: 'private picture', description: 'alice peer' });
  await new Promise(setImmediate);
  assert.deepEqual(store.getState().profiles, {});
});

test('hub callbacks stop updating stores as soon as their session ends', () => {
  const { session } = setup({});
  const received = [];
  const callback = session.guardSessionCallback((value) => { received.push(value); });
  callback('alice update');
  session.resetSessionScope('bob');
  callback('late alice update');
  assert.deepEqual(received, ['alice update']);
});

test('an older inbox response cannot overwrite a newer live refresh', async () => {
  const gates = [deferred(), deferred()]; let index = 0;
  const { load } = setup({ 'src/api/chat.ts': { getAll: () => gates[index++].promise } });
  const store = load('src/store/conversationStore.ts').useConversationStore;
  const old = store.getState().loadConversations(), fresh = store.getState().loadConversations();
  gates[1].resolve([{ username: 'peer', unAcknowledgedMessageCount: 2 }]); await fresh;
  gates[0].resolve([]); await old;
  assert.equal(store.getState().totalUnread, 2);
});

test('older private and room thread snapshots cannot erase a newly received message', async () => {
  for (const [api, file, argument] of [['chat', 'conversationStore', 'peer'], ['rooms', 'roomStore', 'music']]) {
    const gates = [deferred(), deferred()]; let index = 0;
    const { load } = setup({ [`src/api/${api}.ts`]: { getMessages: () => gates[index++].promise } });
    const module = load(`src/store/${file}.ts`);
    const store = api === 'chat' ? module.useConversationStore : module.useRoomStore;
    const old = store.getState().loadMessages(argument), fresh = store.getState().loadMessages(argument);
    gates[1].resolve([{ message: 'new' }]); await fresh;
    gates[0].resolve([]); await old;
    assert.equal(store.getState().messages[argument][0].message, 'new');
  }
});

test('background membership checks reuse room users and history until membership changes', async () => {
  let names = ['music']; const fetched = [];
  const { load } = setup({ 'src/api/rooms.ts': {
    getJoinedNames: async () => names,
    getRoom: async (name) => { fetched.push(name); return { name, isPrivate: false, owner: null,
      operatorCount: 0, operators: [], users: [], messages: [] }; },
  } });
  const store = load('src/store/roomStore.ts').useRoomStore;
  await store.getState().loadJoined(true); await store.getState().loadJoined(true);
  assert.deepEqual(fetched, ['music']);
  names = ['music', 'new']; await store.getState().loadJoined(true);
  assert.deepEqual(fetched, ['music', 'new']);
});

test('room updates refresh previews and a late response cannot resurrect a room after leaving', async () => {
  let next = Promise.resolve([{ message: 'new' }]);
  const { load } = setup({ 'src/api/rooms.ts': { getMessages: () => next, leave: async () => {} } });
  const store = load('src/store/roomStore.ts').useRoomStore;
  store.setState({ joined: [{ name: 'music', messages: [] }] });
  await store.getState().loadMessages('music');
  assert.equal(store.getState().joined[0].messages[0].message, 'new');
  const gate = deferred(); next = gate.promise;
  const pending = store.getState().loadMessages('music');
  await store.getState().leave('music'); gate.resolve([{ message: 'late' }]); await pending;
  assert.equal(store.getState().messages.music, undefined);
});
