// <copyright file="SearchDetailHeader.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

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
            className="sr-btn hover-fx"
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
          className="sr-btn hover-fx sr-btn--danger"
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
