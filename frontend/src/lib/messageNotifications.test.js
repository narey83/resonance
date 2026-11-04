import {
  notificationUnreadCount,
  syncMessageNotifications,
} from './messageNotifications';

describe('message notifications', () => {
  it('uses shared message totals even with duplicate room alerts and missing history', () => {
    expect.hasAssertions();
    const history = [
      { id: 1, type: 'RoomMention', data: { roomName: 'music' }, read: false },
      {
        id: 2,
        type: 'RoomMessageReceived',
        data: { message: { roomName: 'music' } },
        read: false,
      },
      { id: 3, type: 'ActionError', read: false },
    ];
    const unread = syncMessageNotifications(
      history,
      { alice: 3 },
      { music: 4 },
      {},
    );
    expect(notificationUnreadCount(unread)).toBe(8);
    expect(unread.find((n) => n.id === 2).read).toBe(true);
    const read = syncMessageNotifications(
      history,
      { alice: 0 },
      { music: 0 },
      {},
    );
    expect(notificationUnreadCount(read)).toBe(1);
    expect(
      notificationUnreadCount(
        syncMessageNotifications(
          history,
          { alice: 3 },
          { music: 4 },
          {
            PrivateMessageReceived: false,
            RoomMessageReceived: false,
            RoomMention: false,
          },
        ),
      ),
    ).toBe(1);
  });
});
