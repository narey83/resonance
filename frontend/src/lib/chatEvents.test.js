import {
  emitPrivateMessage,
  emitRoomMessage,
  onPrivateMessage,
  onRoomMessage,
} from './chatEvents';

describe.each([
  ['room', emitRoomMessage, onRoomMessage],
  ['private', emitPrivateMessage, onPrivateMessage],
])('%s message notifications', (_name, emit, subscribe) => {
  it('delivers the message without returning a SignalR invocation result', () => {
    const receive = jest.fn();
    const unsubscribe = subscribe(receive);
    const detail = { message: 'test notification', username: 'test' };
    try {
      expect(emit(detail)).toBeUndefined();
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive).toHaveBeenCalledWith(detail);
      unsubscribe();
      emit(detail);
      expect(receive).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
