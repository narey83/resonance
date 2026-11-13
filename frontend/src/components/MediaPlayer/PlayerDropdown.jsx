import './PlayerDropdown.css';
import { ChevronDown } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PlayerDropdown = ({
  className = '',
  disabled = false,
  label,
  onChange,
  options,
  value,
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    const doc = trigger.ownerDocument;
    const view = doc.defaultView;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const availableBelow = view.innerHeight - rect.bottom - 8;
      const availableAbove = rect.top - 8;
      const above = availableBelow < 180 && availableAbove > availableBelow;
      const width = Math.min(Math.max(rect.width, 170), view.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, view.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(
          60,
          Math.min(320, above ? availableAbove : availableBelow),
        ),
        ...(above
          ? { bottom: view.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    };

    const closeOutside = (event) => {
      if (
        !trigger.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        setOpen(false);
    };

    updatePosition();
    doc.addEventListener('pointerdown', closeOutside);
    view.addEventListener('resize', updatePosition);
    doc.addEventListener('scroll', updatePosition, true);
    return () => {
      doc.removeEventListener('pointerdown', closeOutside);
      view.removeEventListener('resize', updatePosition);
      doc.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (
      open &&
      position &&
      !menuRef.current?.contains(triggerRef.current.ownerDocument.activeElement)
    )
      menuRef.current
        ?.querySelectorAll('[role="option"]')
        [Math.max(0, selectedIndex)]?.focus();
  }, [open, position, selectedIndex]);

  const choose = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onOptionKeyDown = (event, option) => {
    const items = [...menuRef.current.querySelectorAll('[role="option"]')];
    const index = items.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let next = index + direction;
      while (items[next]?.getAttribute('aria-disabled') === 'true')
        next += direction;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const candidates = event.key === 'Home' ? items : items.reverse();
      candidates
        .find((item) => item.getAttribute('aria-disabled') !== 'true')
        ?.focus();
    } else if (
      (event.key === 'Enter' || event.key === ' ') &&
      !option.disabled
    ) {
      event.preventDefault();
      choose(option.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <span className={`mp-dropdown ${className}`.trim()}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="mp-dropdown-trigger"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape') setOpen(false);
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{selected?.label || options[0]?.label}</span>
        <ChevronDown
          aria-hidden="true"
          size={14}
        />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            aria-label={label}
            className="mp-dropdown-options"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setOpen(false);
            }}
            ref={menuRef}
            role="listbox"
            style={position}
          >
            {options.map((option) => (
              <div
                aria-disabled={option.disabled || undefined}
                aria-selected={option.value === value}
                key={option.value}
                onClick={() => !option.disabled && choose(option.value)}
                onKeyDown={(event) => onOptionKeyDown(event, option)}
                role="option"
                tabIndex={-1}
              >
                {option.label}
              </div>
            ))}
          </div>,
          triggerRef.current.ownerDocument.body,
        )}
    </span>
  );
};

export default PlayerDropdown;
