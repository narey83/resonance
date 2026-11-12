import { ChevronDown } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const optionLabel = (item, kind) =>
  `${kind === 'folder' ? item.path : item.name}${
    kind !== 'folder' && typeof item.trackCount === 'number'
      ? ` · ${item.trackCount} tracks`
      : ''
  }`;

const ExportSourcePicker = ({
  disabled,
  kind,
  label,
  onChange,
  options,
  value,
}) => {
  const [open, setOpen] = useState(false);
  const focusIndexRef = useRef(0);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const selected = options.find((item) => (item.id || item.path) === value);
  const placeholder =
    kind === 'playlist'
      ? 'Choose a playlist'
      : kind === 'smart-crate'
        ? 'Choose a smart crate'
        : 'Choose a folder';

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => setOpen(false), [kind]);

  const focusOption = (index) => {
    const items = pickerRef.current?.querySelectorAll('[role="option"]');
    items?.[Math.max(0, Math.min(index, items.length - 1))]?.focus();
  };

  useEffect(() => {
    if (open) focusOption(focusIndexRef.current);
  }, [open]);

  const showOptions = (index) => {
    focusIndexRef.current = index;
    setOpen(true);
  };

  const choose = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onOptionKeyDown = (event, nextValue) => {
    const items = [...pickerRef.current.querySelectorAll('[role="option"]')];
    const index = items.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOption(event.key === 'Home' ? 0 : items.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(nextValue);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="export-source-picker-field">
      <span>{label}</span>
      <div
        className="export-source-picker"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
        ref={pickerRef}
      >
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Export source item"
          className="export-source-picker-trigger"
          disabled={disabled}
          onClick={() =>
            open
              ? setOpen(false)
              : showOptions(
                  value
                    ? options.findIndex(
                        (item) => (item.id || item.path) === value,
                      ) + 1
                    : 0,
                )
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              showOptions(event.key === 'ArrowUp' ? options.length : 0);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          ref={triggerRef}
          type="button"
        >
          <span>{selected ? optionLabel(selected, kind) : placeholder}</span>
          <ChevronDown
            aria-hidden="true"
            size={17}
          />
        </button>
        {open && (
          <div
            aria-label={label}
            className="export-source-picker-options"
            role="listbox"
          >
            <div
              aria-selected={!value}
              onClick={() => choose('')}
              onKeyDown={(event) => onOptionKeyDown(event, '')}
              role="option"
              tabIndex={-1}
            >
              {placeholder}
            </div>
            {options.map((item) => {
              const nextValue = item.id || item.path;
              return (
                <div
                  aria-selected={value === nextValue}
                  key={nextValue}
                  onClick={() => choose(nextValue)}
                  onKeyDown={(event) => onOptionKeyDown(event, nextValue)}
                  role="option"
                  tabIndex={-1}
                >
                  {optionLabel(item, kind)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportSourcePicker;
