import * as prefs from '../lib/prefs';
import { useCallback, useEffect, useRef, useState } from 'react';

const useResizablePanel = (
  storageKey,
  defaultWidth,
  { min = 120, max = 600 } = {},
) => {
  const [width, setWidth] = useState(() => {
    const saved = prefs.get(storageKey, null);
    return saved !== null
      ? Math.max(min, Math.min(max, Number(saved)))
      : defaultWidth;
  });
  const containerRef = useRef(null);

  useEffect(() => {
    prefs.set(storageKey, width);
  }, [storageKey, width]);

  const onDividerMouseDown = useCallback(
    (mouseEvent) => {
      mouseEvent.preventDefault();

      const onMouseMove = (moveEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setWidth(Math.max(min, Math.min(max, moveEvent.clientX - rect.left)));
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [max, min],
  );

  return { containerRef, onDividerMouseDown, width };
};

export default useResizablePanel;
