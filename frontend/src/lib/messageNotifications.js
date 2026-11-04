const messageTarget = ({ data, type }) => {
  if (type === 'PrivateMessageReceived')
    return ['chat', data?.message?.username ?? data?.username];
  if (type === 'RoomMessageReceived' || type === 'RoomMention')
    return ['room', data?.message?.roomName ?? data?.roomName];
  return [];
};

export const notificationUnreadCount = (notifications) =>
  notifications.reduce(
    (count, n) => count + (n.read ? 0 : n.messageCount ?? 1),
    0,
  );

// Give each thread one unread entry. History may contain both a mention and
// a room event for the same message, or may omit older unread messages.
export const syncMessageNotifications = (history, chats, rooms, settings) => {
  const pending = new Map();
  for (const [name, count] of Object.entries(chats ?? {}))
    if (count > 0 && settings.PrivateMessageReceived !== false)
      pending.set(`chat:${name}`, { count, name, kind: 'chat' });
  for (const [name, count] of Object.entries(rooms ?? {}))
    if (count > 0 && settings.RoomMessageReceived !== false)
      pending.set(`room:${name}`, { count, name, kind: 'room' });

  const mentionBudget = new Map(Object.entries(rooms ?? {}));
  const entries = history
    .filter((n) => settings[n.type] !== false)
    .map((n) => {
      const [kind, name] = messageTarget(n);
      if (!kind || !name || (kind === 'chat' ? !chats : !rooms)) return n;
      const key = `${kind}:${name}`;
      const match = pending.get(key);
      if (match) {
        pending.delete(key);
        return { ...n, read: false, messageCount: match.count };
      }

      if (
        n.type === 'RoomMention' &&
        settings.RoomMessageReceived === false &&
        !n.read &&
        mentionBudget.get(name) > 0
      ) {
        mentionBudget.set(name, mentionBudget.get(name) - 1);
        return n;
      }

      return { ...n, read: true };
    });

  return [
    ...Array.from(pending, ([key, { count, kind, name }]) => ({
      id: `unread:${key}`,
      type: kind === 'chat' ? 'PrivateMessageReceived' : 'RoomMessageReceived',
      data: {
        message: kind === 'chat' ? { username: name } : { roomName: name },
      },
      read: false,
      messageCount: count,
      timestamp: new Date(),
    })),
    ...entries,
  ];
};
