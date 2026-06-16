import SearchStatusIcon from '../SearchStatusIcon';
import { Loader2, StopCircle, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

const SearchListRow = ({ onRemove, onSelect, onStop, search, selected }) => {
  const [working, setWorking] = useState(false);

  const invoke = async (function_) => {
    setWorking(true);
    try {
      await function_();
    } catch (error) {
      console.error(error);
    } finally {
      setWorking(false);
    }
  };

  const isComplete = search.state.includes('Completed');

  const handleAction = (event) => {
    event.stopPropagation();
    if (working) return;
    void invoke(isComplete ? () => onRemove(search) : () => onStop(search));
  };

  return (
    <div
      aria-selected={selected}
      className={`sr-search-item${selected ? ' sr-search-item--active' : ''}`}
      onClick={() => !working && onSelect(search.id)}
      onKeyDown={(e) => e.key === 'Enter' && !working && onSelect(search.id)}
      role="option"
      tabIndex={0}
      title={search.searchText}
    >
      <span className="sr-search-item-icon">
        {working ? (
          <Loader2
            className="sr-spin"
            size={13}
          />
        ) : (
          <SearchStatusIcon
            size={13}
            state={search.state}
          />
        )}
      </span>
      <span className="sr-search-item-text">{search.searchText}</span>
      {search.fileCount > 0 && (
        <span className="sr-search-item-count">{search.fileCount}</span>
      )}
      <button
        aria-label={isComplete ? 'Delete search' : 'Stop search'}
        className="sr-search-item-action"
        disabled={working}
        onClick={handleAction}
        title={isComplete ? 'Delete' : 'Stop'}
        type="button"
      >
        {isComplete ? <Trash2 size={12} /> : <StopCircle size={12} />}
      </button>
    </div>
  );
};

export default SearchListRow;
