import './Chat.css';
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from 'semantic-ui-react';

const SendMessageModal = ({ initiateConversation, ...rest }) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setUsername('');
    }
  }, [open]);

  const handleStart = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }

    await initiateConversation(trimmed);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleStart();
    }

    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <Modal
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      open={open}
      {...rest}
    >
      <div className="smm-modal">
        <div className="smm-header">
          <span className="smm-title">New Conversation</span>
          <button
            className="smm-close hover-fx"
            onClick={() => setOpen(false)}
            title="Close"
            type="button"
          >
            <svg
              fill="none"
              height="12"
              viewBox="0 0 12 12"
              width="12"
            >
              <path
                d="M1 1l10 10M11 1L1 11"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>

        <div className="smm-body">
          <div className="smm-field">
            <label
              className="smm-label"
              htmlFor="smm-username"
            >
              Username
            </label>
            <input
              autoComplete="off"
              className="smm-input"
              data-lpignore="true"
              id="smm-username"
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a username…"
              ref={inputRef}
              type="text"
              value={username}
            />
          </div>
        </div>

        <div className="smm-footer">
          <button
            className="smm-btn smm-btn--cancel hover-fx"
            onClick={() => setOpen(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="smm-btn smm-btn--send hover-fx"
            disabled={!username.trim()}
            onClick={handleStart}
            type="button"
          >
            Open
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SendMessageModal;
