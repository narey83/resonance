// <copyright file="Tags.jsx" company="John Narey">
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

import './Tags.css';
import MetadataLookup from '../MetadataLookup/MetadataLookup';
import TagEditor from '../TagEditor/TagEditor';
import TagSanitization from '../TagSanitization/TagSanitization';
import React, { useState } from 'react';

const Tags = () => {
  const [tab, setTab] = useState('editor');

  return (
    <div className="tag-manager">
      <div className="tag-manager-window">
        <div className="tag-manager-tabs">
          <button
            className={`tag-manager-tab hover-fx${tab === 'editor' ? ' tag-manager-tab--active' : ''}`}
            onClick={() => setTab('editor')}
            type="button"
          >
            Editor
          </button>
          <button
            className={`tag-manager-tab hover-fx${tab === 'sanitize' ? ' tag-manager-tab--active' : ''}`}
            onClick={() => setTab('sanitize')}
            type="button"
          >
            Sanitize
          </button>
          <button
            className={`tag-manager-tab hover-fx${tab === 'lookup' ? ' tag-manager-tab--active' : ''}`}
            onClick={() => setTab('lookup')}
            type="button"
          >
            Online lookup
          </button>
        </div>
        <div className="tag-manager-content">
          {tab === 'editor' && <TagEditor />}
          {tab === 'sanitize' && <TagSanitization />}
          {tab === 'lookup' && <MetadataLookup />}
        </div>
      </div>
    </div>
  );
};

export default Tags;
