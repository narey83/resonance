import SearchStatusIcon from '../SearchStatusIcon';
import { RefreshCw, StopCircle, Trash2 } from 'lucide-react';
import React from 'react';

const SearchDetailHeader = ({
  creating,
  disabled,
  loaded,
  loading,
  onRemove,
  onRestart,
  onStop,
  removing,
  restarting,
  search,
  stopping,
}) => {
  const { isComplete, searchText, state } = search;
  const working = loading || creating || removing || stopping || restarting;

  const stopOrRemove = () => {
    if (isComplete) {
      onRemove(search);
    } else {
      onStop(search);
    }
  };

  return (
    <div className="sr-detail-header">
      <span className="sr-detail-header-icon">
        <SearchStatusIcon
          size={16}
          state={state}
        />
      </span>
      <span className="sr-detail-header-title">{searchText}</span>
      <div className="sr-detail-header-actions">
        {loaded && (
          <button
            className="sr-btn"
            disabled={disabled || working}
            onClick={onRestart}
            title="Update Search"
            type="button"
          >
            <RefreshCw
              className={restarting ? 'sr-spin' : ''}
              size={14}
            />
            Update Search
          </button>
        )}
        <button
          className="sr-btn sr-btn--danger"
          disabled={working}
          onClick={stopOrRemove}
          title={isComplete ? 'Delete' : 'Stop'}
          type="button"
        >
          {isComplete ? <Trash2 size={14} /> : <StopCircle size={14} />}
          {loaded && isComplete ? 'Delete' : 'Stop'}
        </button>
      </div>
    </div>
  );
};

export default SearchDetailHeader;
