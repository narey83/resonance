import { useCallback, useEffect, useRef, useState } from 'react';

export const playerWindowBounds = (source = window) => {
  const display = source.screen || {};
  const size = (...values) =>
    Math.floor(
      values.find((value) => Number.isFinite(value) && value > 0) || 1,
    );
  return {
    width: size(
      display.availWidth,
      display.width,
      source.outerWidth,
      source.innerWidth,
    ),
    height: size(
      display.availHeight,
      display.height,
      source.outerHeight,
      source.innerHeight,
    ),
    left: Number.isFinite(display.availLeft)
      ? display.availLeft
      : source.screenX || 0,
    top: Number.isFinite(display.availTop)
      ? display.availTop
      : source.screenY || 0,
  };
};

// The audio element stays in the main window. Only the React view moves, so
// docking or closing this window cannot start a second stream or reset playback.
const usePlayerPopout = () => {
  const [container, setContainer] = useState(null);
  const popup = useRef(null);
  const dispose = useRef(() => {});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const onUnload = () => popup.current?.close();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      alive.current = false;
      dispose.current();
      popup.current?.close();
    };
  }, []);
  const close = useCallback(() => {
    dispose.current();
    popup.current?.close();
    popup.current = null;
    if (alive.current) setContainer(null);
  }, []);

  const open = () => {
    if (popup.current && !popup.current.closed) {
      const bounds = playerWindowBounds(
        popup.current.screen ? popup.current : window,
      );
      popup.current.moveTo?.(bounds.left, bounds.top);
      popup.current.resizeTo?.(bounds.width, bounds.height);
      popup.current.focus();
      return true;
    }

    const { width, height, left, top } = playerWindowBounds();
    const target = window.open(
      new URL('player-popout.html', document.baseURI).href,
      'resonance-media-player',
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!target) return false;
    popup.current = target;
    let observer;
    // Wait for a real same-origin document to commit. Mutating the initial
    // about:blank document during native window creation crashes some Brave
    // builds; never replace the browser's head/body during that transition.
    const onClose = () => {
      dispose.current();
      if (popup.current !== target) return;
      popup.current = null;
      if (alive.current) setContainer(null);
    };

    const mount = () => {
      if (!alive.current || popup.current !== target || target.closed) return;
      const doc = target.document;
      const host = doc.querySelector('#player-root');
      if (!host) return;
      target.removeEventListener('load', mount);
      doc.title = 'Resonance · Player';
      const base = doc.createElement('base');
      base.href = document.baseURI;
      doc.head.append(base);
      for (const style of document.querySelectorAll(
        'link[rel="stylesheet"], style',
      ))
        doc.head.append(style.cloneNode(true));
      const syncTheme = () => {
        doc.documentElement.className = document.documentElement.className;
        doc.documentElement.style.cssText =
          document.documentElement.style.cssText;
        doc.documentElement.style.zoom = '1';
        doc.documentElement.style.setProperty('--app-viewport-height', '100vh');
        doc.body.style.margin = '0';
        doc.body.style.overflow = 'hidden';
      };

      syncTheme();
      observer = new MutationObserver(syncTheme);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      target.addEventListener('pagehide', onClose);
      setContainer(host);
    };

    target.addEventListener('load', mount);
    dispose.current = () => {
      observer?.disconnect();
      target.removeEventListener('load', mount);
      target.removeEventListener('pagehide', onClose);
    };

    target.focus();
    return true;
  };

  return { container, open, close };
};

export default usePlayerPopout;
