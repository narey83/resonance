// Badge reconciliation transfers counters, never room message bodies. Events coalesce and
// the caller's slow foreground timer recovers missed events/reconnections.
export const createMessageBadgeSync = ({
  getConversations,
  getRoomCounts,
  getPage,
  getActiveRoom = () => null,
  isVisible,
  baselines,
  update,
}) => {
  let stopped = false;
  let pending = false;
  let running = false;
  let timer;
  const poll = async () => {
    if (stopped || !isVisible()) return;
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      const [conversations, counts] = await Promise.allSettled([
        getConversations(),
        getRoomCounts(),
      ]);
      if (stopped) return;
      const result = {};
      if (
        conversations.status === 'fulfilled' &&
        Array.isArray(conversations.value)
      ) {
        result.chats = conversations.value.filter(
          (c) => c.hasUnAcknowledgedMessages,
        ).length;
      }

      if (counts.status === 'fulfilled' && Array.isArray(counts.value)) {
        let rooms = 0;
        const joined = new Set();
        const roomUnreadCounts = {};
        for (const { room, count } of counts.value) {
          joined.add(room);
          if (
            (getPage() === 'rooms' && getActiveRoom() === room) ||
            !(room in baselines) ||
            count < baselines[room]
          )
            baselines[room] = count;
          roomUnreadCounts[room] = Math.max(0, count - baselines[room]);
          rooms += roomUnreadCounts[room];
        }

        for (const room of Object.keys(baselines))
          if (!joined.has(room)) delete baselines[room];
        result.rooms = rooms;
        result.roomUnreadCounts = roomUnreadCounts;
      }

      update(result);
    } finally {
      // This owner clears the in-flight flag; later refreshes only mark pending.
      // eslint-disable-next-line require-atomic-updates
      running = false;
      if (pending) {
        pending = false;
        // Callback runs after both functions have been initialised.
        // eslint-disable-next-line no-use-before-define
        refresh();
      }
    }
  };

  const refresh = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, 150);
  };

  return {
    refresh,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
};
