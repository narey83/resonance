import './PageInfo.css';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import React, { useState } from 'react';

/**
 * Collapsible help panel that remembers its state in localStorage.
 * Defaults to open on first visit; closing persists across sessions.
 *
 * Usage:
 *   <PageInfo storageKey="keyanalysis">
 *     <p>Explanation text here…</p>
 *   </PageInfo>
 */
const PageInfo = ({ children, storageKey }) => {
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(`page-info:${storageKey}`);
    return saved === null ? false : saved === '1';
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`page-info:${storageKey}`, next ? '1' : '0');
  };

  return (
    <div className="pi-root">
      <button
        className="pi-toggle"
        onClick={toggle}
        title={open ? 'Hide help' : 'Show help'}
        type="button"
      >
        <HelpCircle size={12} />
        <span className="pi-toggle-label">
          {open ? 'Hide help' : 'About this page'}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <div className="pi-body">{children}</div>}
    </div>
  );
};

export default PageInfo;
