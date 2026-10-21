import { ChevronDown } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Native disclosure semantics, with outside-click/Escape dismissal and a panel
// portalled out of scroll/clip containers so a tall player cannot cut it off.
const LibraryMenu = ({ children, label, summary, wide = false }) => {
  const menuRef = useRef(null);
  const panelRef = useRef(null);
  const focusPanel = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const focusable = () =>
    [
      ...(panelRef.current?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) || []),
    ].filter((element) => element.getClientRects().length > 0);
  useEffect(() => {
    if (open && position && focusPanel.current) {
      focusPanel.current = false;
      focusable()[0]?.focus();
    }
  }, [open, position]);
  useEffect(() => {
    const menu = menuRef.current;
    const doc = menu.ownerDocument;
    const win = doc.defaultView;
    const measure = () => {
      setOpen(menu.open);
      if (!menu.open) return;
      const anchor = menu.querySelector('summary');
      const bounds = anchor.getBoundingClientRect();
      // Fixed-position portals share the application's CSS zoom. Convert the
      // anchor's screen pixels back to that coordinate space before clamping.
      const scale =
        Number.parseFloat(win.getComputedStyle(doc.documentElement).zoom) || 1;
      const viewportWidth = win.innerWidth / scale;
      const viewportHeight = win.innerHeight / scale;
      const width = Math.min(wide ? 440 : 270, viewportWidth - 24);
      const top = bounds.bottom / scale + 7;
      const left = Math.max(
        12,
        Math.min(
          wide ? bounds.left / scale : bounds.right / scale - width,
          viewportWidth - width - 12,
        ),
      );
      setPosition({
        left,
        top,
        width,
        maxHeight: Math.min(500, Math.max(80, viewportHeight - top - 12)),
      });
    };

    const outside = (event) => {
      if (
        !menu.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      )
        menu.open = false;
    };

    menu.addEventListener('toggle', measure);
    const observer = new MutationObserver(measure);
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    win.addEventListener('resize', measure);
    doc.addEventListener('scroll', measure, true);
    doc.addEventListener('pointerdown', outside);
    return () => {
      menu.removeEventListener('toggle', measure);
      observer.disconnect();
      win.removeEventListener('resize', measure);
      doc.removeEventListener('scroll', measure, true);
      doc.removeEventListener('pointerdown', outside);
    };
  }, [wide]);
  const close = () => {
    focusPanel.current = false;
    menuRef.current.open = false;
    menuRef.current.querySelector('summary').focus();
  };

  return (
    <details
      className={`library-toolbar-menu${wide ? ' library-toolbar-menu--wide' : ''}`}
      onClick={(event) => {
        if (event.target.closest('[data-close-menu]')) close();
      }}
      onKeyDown={(event) => {
        const summaryElement = menuRef.current.querySelector('summary');
        const items = focusable();
        if (event.target === summaryElement && event.key === 'ArrowDown') {
          event.preventDefault();
          if (menuRef.current.open) items[0]?.focus();
          else {
            focusPanel.current = true;
            menuRef.current.open = true;
          }
        }

        if (event.key === 'Tab' && menuRef.current.open) {
          if (event.target === summaryElement && !event.shiftKey) {
            event.preventDefault();
            items[0]?.focus();
          } else if (
            (event.shiftKey && event.target === items[0]) ||
            (!event.shiftKey && event.target === items[items.length - 1])
          ) {
            event.preventDefault();
            close();
          }
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      ref={menuRef}
    >
      <summary aria-label={label}>
        {summary || label}
        <ChevronDown
          aria-hidden="true"
          size={12}
        />
      </summary>
      {open &&
        position &&
        createPortal(
          <div
            aria-label={`${label} options`}
            className="library-toolbar-menu-panel"
            ref={panelRef}
            role="group"
            style={position}
          >
            {children}
          </div>,
          menuRef.current.ownerDocument.body,
        )}
    </details>
  );
};

export default LibraryMenu;
