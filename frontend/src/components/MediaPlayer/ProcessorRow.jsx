// <copyright file="ProcessorRow.jsx" company="John Narey">
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
import { createPortal } from 'react-dom';

// One entry in the Processing modal's left-hand list, shared by every
// processor view (EQView, CompressorView, ...) so the row/selection/portal
// boilerplate exists in exactly one place. `children` is that processor's
// detail-pane content, portalled into `detailContainerNode` only while
// selected — the processor itself (and its Web Audio nodes) stays mounted
// and running regardless of selection, this only controls what's visible.
const ProcessorRow = ({
  children,
  detailContainerNode,
  enabled,
  isSelected,
  name,
  onSelect,
  onToggleEnabled,
}) => (
  <>
    <div
      className={`mp-processing-row${isSelected ? ' mp-processing-row--selected' : ''}`}
      onClick={onSelect}
    >
      <button
        aria-pressed={isSelected}
        className="mp-processing-row-name"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        type="button"
      >
        {name}
      </button>
      <input
        aria-label={`Enable ${name}`}
        checked={enabled}
        onChange={onToggleEnabled}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
      />
    </div>

    {isSelected &&
      detailContainerNode &&
      createPortal(children, detailContainerNode)}
  </>
);

export default ProcessorRow;
