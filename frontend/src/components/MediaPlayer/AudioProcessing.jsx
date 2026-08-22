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
import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Launcher + modal for the player's Web Audio processing chain: a list of
// processors on the left (just Performance Mode today — more can be added
// as siblings later), the selected one's settings on the right. This shell
// only tracks which processor is selected, whether the modal is open, and
// an aggregate "is anything on" flag for the button — it has no idea what a
// compressor or limiter is, that's each processor's own business (see
// PerformanceMode.jsx).
//
// The modal is always in the DOM (visibility toggled via CSS), not
// conditionally mounted, so every processor stays alive and running
// regardless of whether the modal happens to be open.
const AudioProcessing = ({ audioRef, targetLufs }) => {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('performance');
  const [activeById, setActiveById] = useState({});
  const [detailNode, setDetailNode] = useState(null);

  const setActive = (id, active) => {
    setActiveById((previous) =>
      previous[id] === active ? previous : { ...previous, [id]: active },
    );
  };

  const anyActive = Object.values(activeById).some(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

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

      {createPortal(
        <div
          aria-label="Audio processing"
          className={`mp-processing-overlay${open ? '' : ' mp-processing-overlay--hidden'}`}
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="mp-processing-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mp-processing-modal-header">
              <span>Audio Processing</span>
              <button
                className="mp-processing-modal-close hover-fx"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mp-processing-modal-body">
              <div className="mp-processing-modal-list">
                <PerformanceMode
                  audioRef={audioRef}
                  detailContainerNode={detailNode}
                  isSelected={selectedId === 'performance'}
                  onActiveChange={(active) => setActive('performance', active)}
                  onSelect={() => setSelectedId('performance')}
                  targetLufs={targetLufs}
                />
              </div>

              <div
                className="mp-processing-modal-detail"
                ref={setDetailNode}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AudioProcessing;
