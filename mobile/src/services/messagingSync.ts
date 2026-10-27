import { AppState } from 'react-native';
import type { HubConnection } from '@microsoft/signalr';
import { useConversationStore } from '../store/conversationStore';
import { useRoomStore } from '../store/roomStore';

// One app-wide receiver, independent of which navigation screens have mounted.
// Coalesce bursts per thread, but run once more if an event arrives during a fetch.
export function startMessagingSync(hub: HubConnection, current: () => boolean) {
  let stopped = false;
  const work = new Map<string, { dirty: boolean }>();
  const alive = () => !stopped && current();
  const refresh = (key: string, task: () => Promise<unknown>) => {
    if (!alive()) return;
    const pending = work.get(key);
    if (pending) { pending.dirty = true; return; }
    const state = { dirty: true };
    work.set(key, state);
    void (async () => {
      try {
        while (alive() && state.dirty) {
          state.dirty = false;
          try { await task(); } catch { /* Next event/resume/poll retries. */ }
        }
      } finally { work.delete(key); }
    })();
  };
  const conversation = ({ username }: { username: string }) => {
    refresh('conversations', () => useConversationStore.getState().loadConversations());
    if (username in useConversationStore.getState().messages) {
      refresh(`pm:${username}`, () => useConversationStore.getState().loadMessages(username));
    }
  };
  const room = ({ roomName }: { roomName: string }) => {
    if (!roomName) return;
    // Fetch the authoritative, bounded history (also handles our own echoed sends).
    refresh(`room:${roomName}`, () => useRoomStore.getState().loadMessages(roomName));
  };
  const reconcile = () => {
    if (!alive()) return;
    refresh('conversations', () => useConversationStore.getState().loadConversations());
    refresh('joined', () => useRoomStore.getState().loadJoined(true));
    for (const username of Object.keys(useConversationStore.getState().messages)) conversation({ username });
    for (const roomName of Object.keys(useRoomStore.getState().messages)) room({ roomName });
  };
  hub.on('PRIVATE_MESSAGE', conversation);
  hub.on('CONVERSATION_CHANGED', conversation);
  hub.on('ROOM_MESSAGE', room);
  hub.on('ROOM_MENTION', room); // Also works against older servers.
  let timer: ReturnType<typeof setTimeout>;
  const poll = () => {
    if (!alive()) return;
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') reconcile();
    timer = setTimeout(poll, 30_000);
  };
  timer = setTimeout(poll, 30_000);
  return {
    reconcile,
    stop() {
      stopped = true;
      clearTimeout(timer);
      hub.off('PRIVATE_MESSAGE', conversation);
      hub.off('CONVERSATION_CHANGED', conversation);
      hub.off('ROOM_MESSAGE', room);
      hub.off('ROOM_MENTION', room);
    },
  };
}
