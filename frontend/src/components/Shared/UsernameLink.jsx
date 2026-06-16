import { FolderSearch, MessageSquare } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useHistory } from 'react-router-dom';

const UsernameLink = ({ className, style, username }) => {
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const history = useHistory();

  const open = menuPos !== null;

  const openMenu = (e) => {
    e.stopPropagation();
    if (open) {
      setMenuPos(null);
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ left: rect.left, top: rect.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setMenuPos(null);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const go = (path) => {
    setMenuPos(null);
    history.push(path, { user: username });
  };

  return (
    <span
      className={`ulink-root${className ? ` ${className}` : ''}`}
      style={style}
    >
      <button
        className="ulink-trigger"
        onClick={openMenu}
        ref={triggerRef}
        title={username}
        type="button"
      >
        {username}
      </button>
      {open &&
        ReactDOM.createPortal(
          <div
            className="ulink-menu"
            ref={menuRef}
            style={{ left: menuPos.left, position: 'fixed', top: menuPos.top }}
          >
            <button
              className="ulink-item"
              onClick={() => go('/chat')}
              type="button"
            >
              <MessageSquare
                size={13}
                strokeWidth={1.75}
              />
              Chat
            </button>
            <button
              className="ulink-item"
              onClick={() => go('/browse')}
              type="button"
            >
              <FolderSearch
                size={13}
                strokeWidth={1.75}
              />
              Browse files
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
};

export default UsernameLink;
