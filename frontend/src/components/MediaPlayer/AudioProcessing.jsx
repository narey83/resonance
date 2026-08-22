// <copyright file="AudioProcessing.jsx" company="John Narey">
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

import PerformanceMode from './PerformanceMode';
import React, { useState } from 'react';

// Launcher for the player's Web Audio processing chain. The "Processing"
// button opens a small popover listing every available processor as its
// own row — just Performance Mode today, with room for more (an EQ, a
// filter, whatever gets decided later) to be added as sibling list items
// without touching this shell. This component only manages the popover's
// open/closed state and a shared "is anything on" indicator on the button;
// it has no idea what a compressor or limiter is — that's each item's own
// business (see PerformanceMode.jsx).
//
// Item components stay mounted for as long as this does (i.e. for as long
// as the player has a track loaded) — closing the popover only hides it via
// CSS, it does not unmount the items, so closing it can't silently disable
// whatever processing is running.
const AudioProcessing = ({ audioRef, targetLufs }) => {
  const [open, setOpen] = useState(false);
  const [activeById, setActiveById] = useState({});

  const setActive = (id, active) => {
    setActiveById((previous) =>
      previous[id] === active ? previous : { ...previous, [id]: active },
    );
  };

  const anyActive = Object.values(activeById).some(Boolean);

  return (
    <div className="mp-processing">
      <button
        className={`mp-processing-btn${anyActive ? ' mp-processing-btn--active' : ''}`}
        onClick={() => setOpen((previous) => !previous)}
        title="Audio processing"
        type="button"
      >
        Processing
      </button>

      <div
        className={`mp-processing-panel${open ? '' : ' mp-processing-panel--hidden'}`}
      >
        <PerformanceMode
          audioRef={audioRef}
          onActiveChange={(active) => setActive('performance', active)}
          targetLufs={targetLufs}
        />
      </div>
    </div>
  );
};

export default AudioProcessing;
