import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import React from 'react';

const SortButton = ({ field, label, onSort, sortBy, sortDir }) => (
  <button
    className={`jb-sort-btn hover-fx${sortBy === field ? ' jb-sort-btn--active' : ''}`}
    onClick={() => onSort(field)}
    type="button"
  >
    {label}
    {sortBy === field &&
      (sortDir === 'asc' ? <ArrowUpAZ size={12} /> : <ArrowDownAZ size={12} />)}
  </button>
);

export default SortButton;
