// <copyright file="ShareTable.jsx" company="JP Dillingham">
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

import React from 'react';
import { Icon } from 'semantic-ui-react';

const ShareTable = ({ onClick, shares }) => (
  <div className="info-section">
    <div className="info-section-title">Shared Directories</div>
    <div className="info-section-body">
      {shares.length === 0 ? (
        <div className="shares-empty">No shares configured</div>
      ) : (
        shares.map((share) => {
          const isManaged = share.isManaged;
          return (
            <div
              className={`shares-row${isManaged ? ' shares-row--managed' : ' shares-row--clickable'}`}
              key={`${share.host}+${share.localPath}`}
              onClick={isManaged ? undefined : () => onClick(share)}
              onKeyDown={
                isManaged
                  ? undefined
                  : ({ key }) => key === 'Enter' && onClick(share)
              }
              role={isManaged ? undefined : 'button'}
              tabIndex={isManaged ? undefined : 0}
            >
              <div className="shares-row-path">
                <Icon
                  name={isManaged ? 'lock' : share.isLocked ? 'lock' : 'folder'}
                />
                {share.localPath}
              </div>
              <div className="shares-row-meta">
                {share.host && <span>{share.host}</span>}
                {isManaged && <span>managed</span>}
                {!isManaged && share.isLocked && (
                  <span>locked (privileged only)</span>
                )}
                {share.directories != null && (
                  <span>{share.directories} dirs</span>
                )}
                {share.files != null && <span>{share.files} files</span>}
                {share.alias && <span>alias: {share.alias}</span>}
                {share.remotePath && <span>remote: {share.remotePath}</span>}
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
);

export default ShareTable;
