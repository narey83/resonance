// <copyright file="MetadataLookupWatcher.jsx" company="John Narey">
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

import { getStatus } from '../../lib/metadataLookup';
import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';

// Renders nothing. Polls the background metadata-lookup service so the user is made
// aware — via toasts — when an enrichment pass starts and finishes, from anywhere in
// the app (the Tags → Online lookup tab shows the detailed live progress).
const MetadataLookupWatcher = () => {
  const wasScanningRef = useRef(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (!active) return;

        if (status.scanning && !wasScanningRef.current) {
          toast.info('Filling in missing track details…');
        } else if (!status.scanning && wasScanningRef.current) {
          toast.success(
            `Metadata lookup finished — ${status.written} updated.`,
          );
        }

        wasScanningRef.current = status.scanning;
      } catch {
        /* ignore transient errors */
      }
    };

    poll();
    const id = setInterval(poll, 8_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return null;
};

export default MetadataLookupWatcher;
