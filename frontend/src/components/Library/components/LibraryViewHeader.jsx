// <copyright file="LibraryViewHeader.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import AlphaFilterChip from './AlphaFilterChip';
import ResetViewButton from './ResetViewButton';
import SortButton from './SortButton';
import { ListFilter, X } from 'lucide-react';
import React, { useState } from 'react';

// The one control bar every collection view renders, in one fixed order:
//
//   Title   12,678   [filter…]        Sort [A–Z ↑] [Tracks]     ⟨letter⟩ ⟨Reset view⟩
//
// Artists, Albums, Folders, Genres and Years each used to build their own — pills in one,
// a <select> in another, counts in three different places, and filter boxes hidden inside
// list-head markup (which is why Genres and Years lost their filter the moment you switched
// to tile view). Composes SortButton/AlphaFilterChip/ResetViewButton rather than restyling
// them, so the controls themselves stay exactly what they were.
const LibraryViewHeader = ({
  filter,
  isDefault = true,
  letter,
  onClearLetter,
  onReset,
  onSort,
  sortBy,
  sortDir,
  sorts = [],
  title,
  total,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const showFilterInput = filterOpen || Boolean(filter?.value);

  return (
    <div className="jb-view-header">
      <span className="jb-view-header-title">{title}</span>

      {total != null && (
        <span className="jb-view-header-count">{total.toLocaleString()}</span>
      )}

      {filter &&
        (showFilterInput ? (
          <span className="jb-col-filter-wrap jb-view-header-filter">
            <input
              autoFocus
              className="jb-col-filter-input"
              onBlur={() => setFilterOpen(false)}
              onChange={(e) => filter.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  filter.onChange('');
                  setFilterOpen(false);
                }

                if (e.key === 'Enter') setFilterOpen(false);
              }}
              placeholder={filter.placeholder ?? 'Filter…'}
              value={filter.value}
            />
            {filter.value && (
              <button
                className="jb-col-filter-x"
                onMouseDown={(e) => {
                  e.preventDefault();
                  filter.onChange('');
                  setFilterOpen(false);
                }}
                type="button"
              >
                <X size={9} />
              </button>
            )}
          </span>
        ) : (
          <button
            className="jb-view-header-filter-btn"
            onClick={() => setFilterOpen(true)}
            title={filter.placeholder ?? 'Filter'}
            type="button"
          >
            <ListFilter size={12} />
          </button>
        ))}

      {sorts.length > 0 && (
        <div className="jb-view-header-sorts">
          <span className="jb-sort-label">Sort</span>
          {sorts.map(({ field, label }) => (
            <SortButton
              field={field}
              key={field}
              label={label}
              onSort={onSort}
              sortBy={sortBy}
              sortDir={sortDir}
            />
          ))}
        </div>
      )}

      <AlphaFilterChip
        letter={letter}
        onClear={onClearLetter}
      />

      {onReset && (
        <ResetViewButton
          hidden={isDefault}
          onReset={onReset}
        />
      )}
    </div>
  );
};

export default LibraryViewHeader;
