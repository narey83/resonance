// <copyright file="DirectoryTree.jsx" company="JP Dillingham">
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
import { List } from 'semantic-ui-react';

const subtree = (root, selectedDirectoryName, onSelect) => {
  return (root || []).map((d) => {
    const selected = d.name === selectedDirectoryName;
    // const dimIfLocked = { opacity: d.locked ? 0.5 : 1 };

    return (
      <List
        className="browse-folderlist-list"
        key={d.name}
      >
        <List.Item>
          <List.Icon
            className={
              'browse-folderlist-icon' +
              (selected ? ' selected' : '') +
              (d.locked ? ' locked' : '')
            }
            name={
              d.locked === true ? 'lock' : selected ? 'folder open' : 'folder'
            }
          />
          <List.Content>
            <List.Header
              className={
                'browse-folderlist-header' +
                (selected ? ' selected' : '') +
                (d.locked ? ' locked' : '')
              }
              onClick={(event) => onSelect(event, d)}
            >
              {d.name.split('\\').pop().split('/').pop()}
            </List.Header>
            <List.List>
              {subtree(d.children, selectedDirectoryName, onSelect)}
            </List.List>
          </List.Content>
        </List.Item>
      </List>
    );
  });
};

const DirectoryTree = ({ onSelect, selectedDirectoryName, tree }) =>
  subtree(tree, selectedDirectoryName, onSelect);

export default DirectoryTree;
