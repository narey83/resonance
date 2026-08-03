// <copyright file="LibraryDetailHeader.jsx" company="John Narey">
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

import { hueColour } from '../../../lib/accentHue';
import AlphaFilterChip from './AlphaFilterChip';
import ResetViewButton from './ResetViewButton';
import { ChevronLeft } from 'lucide-react';
import React from 'react';

// The one header every drill-down renders — artist, album, folder, genre, year. Genres and
// Years already had this tinted band (under a `jb-year-detail-*` class, which is why Genres
// was rendering inside markup named "year"); Artists and Folders had a plain grey bar and
// AlbumDetail had a third thing. `hue` carries the accent: from the artwork where there is
// any, otherwise hashed from the name — see lib/accentHue.
const LibraryDetailHeader = ({
  actions,
  hue,
  isDefault = true,
  letter,
  meta,
  onBack,
  onClearLetter,
  onReset,
  title,
}) => {
  const colour = hue == null ? null : hueColour(hue);

  return (
    <div
      className="jb-detail-header"
      style={
        colour
          ? {
              background: `color-mix(in srgb, ${colour} 10%, var(--bg-primary))`,
              borderBottomColor: `color-mix(in srgb, ${colour} 25%, var(--border))`,
            }
          : undefined
      }
    >
      <button
        className="jb-icon-btn"
        onClick={onBack}
        title="Back"
        type="button"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="jb-detail-header-text">
        <div
          className="jb-detail-header-title"
          style={colour ? { color: colour } : undefined}
        >
          {title}
        </div>
        {meta != null && <div className="jb-detail-header-meta">{meta}</div>}
      </div>

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

      {actions}
    </div>
  );
};

export default LibraryDetailHeader;
