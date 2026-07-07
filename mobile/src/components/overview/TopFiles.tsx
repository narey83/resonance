// <copyright file="TopFiles.tsx" company="John Narey">
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
import { TransferFileSummary } from '../../api/analytics';
import { BarRow, Card, EmptyState, fmtNum } from './shared';

const basename = (path: string): string => path.split(/[/\\]/).pop() ?? path;

export default function TopFiles({ files, colors }: { files: TransferFileSummary[]; colors: ThemeColors }) {
  const max = Math.max(1, ...files.map((f) => f.count));

  if (files.length === 0) {
    return <Card colors={colors}><EmptyState text="No downloads in this window." colors={colors} /></Card>;
  }

  return (
    <Card colors={colors}>
      {files.map((f, i) => (
        <BarRow
          key={f.filename}
          label={basename(f.filename)}
          value={`${fmtNum(f.count)}×`}
          fraction={f.count / max}
          colors={colors}
          last={i === files.length - 1}
        />
      ))}
    </Card>
  );
}
