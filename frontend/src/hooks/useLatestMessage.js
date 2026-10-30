import { useLayoutEffect, useRef } from 'react';

// Keep the newest message visible after React, virtual rows, previews and
// viewport resizing settle. Reading older messages is allowed until a new
// message arrives or the user changes conversation.
export default function useLatestMessage(
  scrollRef,
  { active, count, latest, loading, virtualizer },
) {
  const follow = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || loading) return undefined;
    follow.current = true;
    let frame;
    let userScrolling = false;
    const onScrollIntent = () => {
      userScrolling = true;
    };

    const schedule = () => {
      if (!follow.current || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (follow.current) element.scrollTop = element.scrollHeight;
      });
    };

    const onScroll = () => {
      if (!userScrolling) return;
      follow.current =
        element.scrollHeight - element.clientHeight - element.scrollTop < 48;
    };

    const resize = new ResizeObserver((entries = []) => {
      // Reflow can fire a scroll event before ResizeObserver runs. A viewport
      // resize must restore following even if that event looked like history scrolling.
      if (entries.some((entry) => entry.target === element))
        follow.current = true;
      schedule();
    });
    const observeChildren = () => {
      for (const child of element.children) resize.observe(child);
    };

    resize.observe(element);
    observeChildren();
    const mutations = new MutationObserver(() => {
      observeChildren();
      schedule();
    });
    mutations.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    element.addEventListener('scroll', onScroll, { passive: true });
    for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown'])
      element.addEventListener(event, onScrollIntent, { passive: true });
    element.addEventListener('load', schedule, true);
    if (virtualizer && count)
      virtualizer.scrollToIndex(count - 1, { align: 'end' });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      element.removeEventListener('scroll', onScroll);
      for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown'])
        element.removeEventListener(event, onScrollIntent);
      element.removeEventListener('load', schedule, true);
    };
  }, [scrollRef, active, count, latest, loading, virtualizer]);
}
