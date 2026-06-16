import React from 'react';

const ROOT = {
  display: 'inline-flex',
  borderRadius: '5px',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  flexShrink: 0,
};

const button = (active) => ({
  background: active ? 'var(--accent)' : 'none',
  border: 'none',
  color: active ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.03em',
  padding: '3px 8px',
  transition: 'background 0.15s, color 0.15s',
});

const KeyFormatToggle = ({ format, onChange }) => {
  return (
    <div
      style={ROOT}
      title="Key display format"
    >
      <button
        onClick={() => onChange('camelot')}
        style={button(format === 'camelot')}
        type="button"
      >
        Camelot
      </button>
      <button
        onClick={() => onChange('standard')}
        style={button(format === 'standard')}
        type="button"
      >
        Musical
      </button>
    </div>
  );
};

export default KeyFormatToggle;
