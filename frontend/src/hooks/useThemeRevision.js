import { useEffect, useState } from 'react';

// One observer for all visible previews; cached audio peaks remain reusable.
const listeners = new Set();
let observer;
let revision = 0;
export default function useThemeRevision() {
  const [value, setValue] = useState(revision);
  useEffect(() => {
    listeners.add(setValue);
    if (!observer) {
      let lastTheme = document.documentElement.className;
      observer = new MutationObserver(() => {
        const theme = document.documentElement.className;
        if (theme === lastTheme) return;
        lastTheme = theme;
        revision += 1;
        for (const listener of listeners) listener(revision);
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    setValue(revision);
    return () => {
      listeners.delete(setValue);
      if (!listeners.size) {
        observer.disconnect();
        observer = null;
      }
    };
  }, []);
  return value;
}
