const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('room badges count ordinary traffic, clear on read and recover from counter reset', async () => {
  let counts = [{ room: 'music', count: 100 }];
  let active = true;
  const load = mobileModules({
    'src/api/rooms.ts': { getMessageCounts: async () => counts },
    'src/api/linkPreview.ts': { prefetchMessagePreviews() {} },
    'src/lib/sessionScope.ts': { sessionGuard: () => () => active, onSessionReset() {} },
  });
  const { useRoomStore, totalRoomUnread } = load('src/store/roomStore.ts');
  await useRoomStore.getState().loadUnread();
  counts = [{ room: 'music', count: 105 }];
  await useRoomStore.getState().loadUnread();
  assert.equal(totalRoomUnread(useRoomStore.getState()), 5);
  useRoomStore.getState().markRead('music');
  assert.equal(totalRoomUnread(useRoomStore.getState()), 0);
  counts = [{ room: 'music', count: 1 }];
  await useRoomStore.getState().loadUnread();
  assert.equal(totalRoomUnread(useRoomStore.getState()), 0);
  counts = [];
  active = false;
  await useRoomStore.getState().loadUnread();
  assert.deepEqual(useRoomStore.getState().unread, { music: 0 });
  active = true;
  await useRoomStore.getState().loadUnread();
  assert.deepEqual(useRoomStore.getState().unread, {});
});
