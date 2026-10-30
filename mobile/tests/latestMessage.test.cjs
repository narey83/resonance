const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('inverted chats follow latest arrivals and layout changes without blocking history scrolling', () => {
  const originalRequest = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;
  const frames = new Map();
  let next = 0, focus;
  global.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
  global.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  try {
    const load = mobileModules({
      react: { useRef: value => ({ current: value }), useCallback: callback => callback },
      '@react-navigation/native': { useFocusEffect: effect => { focus = effect; } },
    });
    const { useLatestMessage } = load('src/hooks/useLatestMessage.ts');
    const hook = useLatestMessage('room:test', 'first');
    const offsets = [];
    hook.listRef.current = { scrollToOffset: value => offsets.push(value) };
    let cleanup = focus();
    flush();
    assert.deepEqual(offsets, [{ offset: 0, animated: false }]);
    hook.onScroll({ nativeEvent: { contentOffset: { y: 200 } } });
    hook.onContentSizeChange();
    flush();
    assert.equal(offsets.length, 1, 'older messages remain readable between arrivals');
    cleanup();
    cleanup = focus();
    flush();
    assert.equal(offsets.length, 2, 'focus or a new latest message returns to the newest');
    hook.onContentSizeChange();
    flush();
    assert.equal(offsets.length, 3, 'late message measurement keeps the latest visible');
    hook.onLayout();
    cleanup();
    flush();
    assert.equal(offsets.length, 3, 'blur cancels queued native scrolling');
  } finally {
    global.requestAnimationFrame = originalRequest;
    global.cancelAnimationFrame = originalCancel;
  }
});
