import { ChevronDown } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

const RecipientStatusDropdown = ({ groups, label, onChange, value }) => {
  const dropdown = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      if (dropdown.current && !dropdown.current.contains(event.target)) {
        dropdown.current.open = false;
      }
    };

    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const close = () => {
    dropdown.current.open = false;
    dropdown.current.querySelector('summary').focus();
  };

  const selected = groups.find((group) => group.label === value);
  return (
    <details
      className="ul-recipient-status"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        } else if (
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        ) {
          event.preventDefault();
          const items = Array.from(
            dropdown.current.querySelectorAll('[role="menuitemradio"]'),
          );
          const index = items.indexOf(document.activeElement);
          let next = 0;
          if (event.key === 'End') next = items.length - 1;
          else if (event.key === 'ArrowDown') next = (index + 1) % items.length;
          else if (event.key === 'ArrowUp') {
            next =
              index < 0
                ? items.length - 1
                : (index + items.length - 1) % items.length;
          }

          dropdown.current.open = true;
          items[next].focus();
        }
      }}
      ref={dropdown}
    >
      <summary
        aria-haspopup="menu"
        aria-label={label}
      >
        <span>
          {value} ({selected.users.length})
        </span>
        <ChevronDown
          aria-hidden="true"
          size={12}
        />
      </summary>
      <div
        aria-label={`${label} options`}
        className="ul-recipient-status-menu"
        role="menu"
      >
        {groups.map((group) => (
          <button
            aria-checked={group.label === value}
            key={group.label}
            onClick={() => {
              onChange(group.label);
              close();
            }}
            role="menuitemradio"
            type="button"
            value={group.label}
          >
            {group.label} ({group.users.length})
          </button>
        ))}
      </div>
    </details>
  );
};

export default RecipientStatusDropdown;
