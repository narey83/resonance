import SearchListRow from './SearchListRow';
import React from 'react';

const SearchList = ({
  onRemove = () => {},
  onSelect = () => {},
  onStop = () => {},
  searches = {},
  selectedId = null,
}) => {
  const sorted = Object.values(searches).sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt),
  );

  if (sorted.length === 0) {
    return <div className="sr-search-list-empty">No searches yet</div>;
  }

  return (
    <div className="sr-search-list">
      {sorted.map((search) => (
        <SearchListRow
          key={search.id}
          onRemove={onRemove}
          onSelect={onSelect}
          onStop={onStop}
          search={search}
          selected={selectedId === search.id}
        />
      ))}
    </div>
  );
};

export default SearchList;
