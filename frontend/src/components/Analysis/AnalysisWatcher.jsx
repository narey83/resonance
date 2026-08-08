// <copyright file="AnalysisWatcher.jsx" company="John Narey">
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

import { getScanState } from '../../lib/analysis';
import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';

// Renders nothing. Polls the analysis scan state so a BPM/key/waveform/loudness pass —
// including the automatic one triggered by a fresh download, which nobody clicked a
// button to start — is announced from anywhere in the app, not only from the Track
// Analysis page (see AnalysisWatcher's sibling, MetadataLookupWatcher).
const AnalysisWatcher = () => {
  const wasScanningRef = useRef(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const state = await getScanState();
        if (!active) return;

        if (state.scanning && !wasScanningRef.current) {
          toast.info('Analysing tracks — BPM, key, waveform, loudness…');
        } else if (!state.scanning && wasScanningRef.current) {
          const count = state.analysed ?? 0;
          const noun = `track${count === 1 ? '' : 's'}`;
          if (state.cancelled) {
            toast.warn(`Analysis cancelled — ${count} ${noun} analysed.`);
          } else if (count > 0) {
            toast.success(`Analysis finished — ${count} ${noun} updated.`);
          }
        }

        wasScanningRef.current = state.scanning;
      } catch {
        /* ignore transient errors */
      }
    };

    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return null;
};

export default AnalysisWatcher;
