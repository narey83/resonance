import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Inverted message lists place the newest message at offset zero. */
export function useLatestMessage<T>(thread: string, latest: string) {
  const listRef = useRef<FlatList<T>>(null);
  const following = useRef(true);
  const frame = useRef<number | null>(null);
  const queue = useCallback(() => {
    if (!following.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (following.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);
  const showLatest = useCallback(() => {
    following.current = true;
    queue();
  }, [queue]);
  useFocusEffect(useCallback(() => {
    if (!thread || !latest) return undefined;
    showLatest();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [thread, latest, showLatest]));
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (frame.current === null) following.current = event.nativeEvent.contentOffset.y < 48;
  }, []);
  return { listRef, onScroll, onContentSizeChange: queue, onLayout: showLatest, showLatest };
}
