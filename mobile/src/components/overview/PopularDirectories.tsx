// <copyright file="PopularDirectories.tsx" company="John Narey">
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

import React from 'react';
import { ThemeColors } from '../../theme';
import { TransferDirectorySummary } from '../../api/analytics';
import { BarRow, Card, EmptyState, fmtNum } from './shared';

// Directories arrive as share-relative paths (`downloads\HATE`, `music\HATE`).
// The share root is noise on a phone — it's the same one or two names on every
// row — so show the leaf folder only. Two shares holding the same album do then
// render as two identically-labelled rows, which is what the data says.
const leafName = (path: string): string => path.split(/[/\\]/).filter(Boolean).pop() ?? path;

export default function PopularDirectories({ directories, colors }: { directories: TransferDirectorySummary[]; colors: ThemeColors }) {
  const max = Math.max(1, ...directories.map((d) => d.distinctUsers));

  if (directories.length === 0) {
    return <Card colors={colors}><EmptyState text="No directory activity in this window." colors={colors} /></Card>;
  }

  return (
    <Card colors={colors}>
      {directories.map((d, i) => (
        <BarRow
          key={d.directory}
          label={leafName(d.directory)}
          value={`${fmtNum(d.distinctUsers)} users`}
          fraction={d.distinctUsers / max}
          colors={colors}
          last={i === directories.length - 1}
        />
      ))}
    </Card>
  );
}
