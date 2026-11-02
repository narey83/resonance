import { createMessageBadgeSync } from './messageBadgeSync';

const flush = async () => {
  jest.advanceTimersByTime(151);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('message badge reconciliation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('coalesces events and uses monotonically growing counters beyond the message window', async () => {
    expect.hasAssertions();
    let count = 100;
    const getRoomCounts = jest.fn(async () => [{ room: 'music', count }]);
    const update = jest.fn();
    const sync = createMessageBadgeSync({
      getRoomCounts,
      getConversations: async () => [{ hasUnAcknowledgedMessages: true }],
      getPage: () => 'library',
      isVisible: () => true,
      baselines: {},
      update,
    });
    sync.refresh();
    sync.refresh();
    await flush();
    expect(getRoomCounts).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({
      chats: 1,
      rooms: 0,
      roomUnreadCounts: { music: 0 },
    });
    count = 145;
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 1,
      rooms: 45,
      roomUnreadCounts: { music: 45 },
    });
    sync.stop();
  });
  it('skips background work, acknowledges room view and ignores results after unmount', async () => {
    expect.hasAssertions();
    let page = 'library';
    let visible = false;
    const getRoomCounts = jest.fn(async () => [{ room: 'music', count: 200 }]);
    const update = jest.fn();
    const sync = createMessageBadgeSync({
      getRoomCounts,
      getConversations: async () => [],
      getPage: () => page,
      getActiveRoom: () => 'music',
      isVisible: () => visible,
      baselines: { music: 100 },
      update,
    });
    sync.refresh();
    await flush();
    expect(getRoomCounts).not.toHaveBeenCalled();
    visible = true;
    page = 'rooms';
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 0,
      rooms: 0,
      roomUnreadCounts: { music: 0 },
    });
    sync.stop();
    sync.refresh();
    await flush();
    expect(getRoomCounts).toHaveBeenCalledTimes(1);
  });
  it('acknowledges only the open room and handles counter resets and rooms left', async () => {
    expect.hasAssertions();
    let activeRoom = 'music';
    let counts = [
      { room: 'music', count: 110 },
      { room: 'other', count: 220 },
    ];
    const update = jest.fn();
    const baselines = { music: 100, other: 200, left: 50 };
    const sync = createMessageBadgeSync({
      getRoomCounts: async () => counts,
      getConversations: async () => [],
      getPage: () => 'rooms',
      getActiveRoom: () => activeRoom,
      isVisible: () => true,
      baselines,
      update,
    });
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 0,
      rooms: 20,
      roomUnreadCounts: { music: 0, other: 20 },
    });
    expect(baselines).not.toHaveProperty('left');
    activeRoom = 'other';
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 0,
      rooms: 0,
      roomUnreadCounts: { music: 0, other: 0 },
    });
    activeRoom = null;
    counts = [{ room: 'music', count: 2 }];
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 0,
      rooms: 0,
      roomUnreadCounts: { music: 0 },
    });
    sync.stop();
  });
  it('partial failures preserve the unaffected badge', async () => {
    expect.hasAssertions();
    const update = jest.fn();
    const sync = createMessageBadgeSync({
      getRoomCounts: async () => {
        throw new Error('offline');
      },
      getConversations: async () => [{ hasUnAcknowledgedMessages: true }],
      getPage: () => 'library',
      isVisible: () => true,
      baselines: {},
      update,
    });
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({ chats: 1 });
    sync.stop();
  });
});

describe('stored room baselines', () => {
  it('retains unread room counts across synchronizer restarts', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    const update = jest.fn();
    const saveBaselines = jest.fn();
    const sync = createMessageBadgeSync({
      getConversations: async () => [],
      getRoomCounts: async () => [{ room: 'music', count: 108 }],
      getPage: () => 'library',
      isVisible: () => true,
      baselines: { music: 100 },
      saveBaselines,
      update,
    });
    sync.refresh();
    await flush();
    expect(update).toHaveBeenLastCalledWith({
      chats: 0,
      rooms: 8,
      roomUnreadCounts: { music: 8 },
    });
    expect(saveBaselines).toHaveBeenCalledWith({ music: 100 });
    sync.stop();
    jest.useRealTimers();
  });
});
