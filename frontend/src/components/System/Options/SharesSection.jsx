import FolderPicker from '../../Shared/FolderPicker';
import React, { useState } from 'react';
import { Icon } from 'semantic-ui-react';

const normalize = (p) => p.replace(/^[!-]/u, '').trim();

const DirectoryList = ({
  allValues,
  disabled,
  items,
  onAdd,
  onRemove,
  placeholder,
  title,
  type,
}) => {
  const [newPath, setNewPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const trimmed = newPath.trim();
  const normed = normalize(trimmed);

  const existingMatch = normed
    ? allValues.find((d) => normalize(d) === normed)
    : null;

  const validationError = existingMatch
    ? existingMatch.startsWith('-') || existingMatch.startsWith('!')
      ? 'Already configured as an exclusion'
      : 'Already configured as a shared directory'
    : null;

  const canAdd = !disabled && trimmed && !validationError;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(trimmed);
    setNewPath('');
  };

  return (
    <>
      {pickerOpen && (
        <FolderPicker
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setNewPath(path);
            setPickerOpen(false);
          }}
        />
      )}
      <div className="info-section">
        <div className="info-section-title">{title}</div>
        <div className="info-section-body">
          {items.length === 0 && (
            <div className="shares-empty">
              No {type === 'exclusion' ? 'exclusions' : 'directories'}{' '}
              configured
            </div>
          )}
          {items.map((raw) => {
            const display = type === 'exclusion' ? raw.slice(1) : raw;
            return (
              <div
                className="shares-item"
                key={raw}
              >
                <span
                  className={`shares-item-path${type === 'exclusion' ? ' shares-item-path--excluded' : ''}`}
                >
                  <Icon name={type === 'exclusion' ? 'ban' : 'folder'} />
                  {display}
                </span>
                <button
                  className="shares-remove-btn"
                  disabled={disabled}
                  onClick={() => onRemove(raw)}
                  title="Remove"
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })}
          <div className="shares-add-row">
            <div className="shares-add-input-wrap">
              <input
                className={`opt-input opt-input--folder${validationError ? ' opt-input--error' : ''}`}
                disabled={disabled}
                onChange={({ target }) => setNewPath(target.value)}
                onKeyDown={({ key }) => key === 'Enter' && handleAdd()}
                placeholder={placeholder}
                type="text"
                value={newPath}
              />
              {validationError && (
                <span className="shares-validation-error">
                  {validationError}
                </span>
              )}
            </div>
            <button
              className="opt-browse-btn"
              disabled={disabled}
              onClick={() => setPickerOpen(true)}
              type="button"
            >
              Browse…
            </button>
            <button
              className="shares-add-btn"
              disabled={!canAdd}
              onClick={handleAdd}
              type="button"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const ScanProgress = ({ state }) => {
  if (!state?.scanning) return null;

  const pct = Math.round((state.scanProgress ?? 0) * 100);

  return (
    <div className="shares-scan-banner">
      <div className="shares-scan-top">
        <span className="shares-scan-label">
          Scanning… found {(state.files ?? 0).toLocaleString()} files in{' '}
          {state.directories ?? 0} directories
        </span>
        <span className="shares-scan-pct">{pct}%</span>
      </div>
      <div className="shares-scan-track">
        <div
          className="shares-scan-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const SharesSection = ({
  disabled,
  managedPaths = [],
  onChange,
  scanState,
  value = [],
}) => {
  const shared = value.filter((d) => !d.startsWith('-') && !d.startsWith('!'));
  const excluded = value.filter((d) => d.startsWith('-') || d.startsWith('!'));

  const remove = (raw) => onChange(value.filter((d) => d !== raw));

  return (
    <div className="shares-cards">
      <ScanProgress state={scanState} />
      {managedPaths.length > 0 && (
        <div className="info-section">
          <div className="info-section-title">Managed Directories</div>
          <div className="info-section-body">
            {managedPaths.map((p) => (
              <div
                className="shares-item shares-item--managed"
                key={p.localPath}
              >
                <span className="shares-item-path shares-item-path--managed">
                  <svg
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <rect
                      height="11"
                      rx="1"
                      width="18"
                      x="3"
                      y="11"
                    />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {p.localPath}
                </span>
                <span className="shares-item-managed-label">
                  auto-managed · {p.alias}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <DirectoryList
        allValues={value}
        disabled={disabled}
        items={shared}
        onAdd={(path) => onChange([...value, path])}
        onRemove={remove}
        placeholder="/path/to/music"
        title="Shared Directories"
        type="shared"
      />
      <DirectoryList
        allValues={value}
        disabled={disabled}
        items={excluded}
        onAdd={(path) => onChange([...value, `-${path}`])}
        onRemove={remove}
        placeholder="/path/to/exclude"
        title="Exclusions"
        type="exclusion"
      />
    </div>
  );
};

export default SharesSection;
