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
import { Loader2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

// Polls metadata enrichment and renders its active progress in the status strip.
// The user is also made
// aware — via toasts — when an enrichment pass starts and finishes, from anywhere in
// the app (the Tags → Online lookup tab shows the detailed live progress).
const hasActiveWork = (status) =>
  status?.scanning &&
  !status.paused &&
  status.total > 0 &&
  ((status.inFlight || 0) > 0 ||
    (status.written || 0) + (status.skipped || 0) + (status.failed || 0) > 0);

const MetadataLookupWatcher = () => {
  const observedWorkRef = useRef(false);
  const [scanStatus, setScanStatus] = useState(null);

  useEffect(() => {
    let active = true;
    let timer;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (!active) return;
        setScanStatus(status);

        if (hasActiveWork(status) && !observedWorkRef.current) {
          toast.info('Looking up missing track details…');
          observedWorkRef.current = true;
        }

        if (!status.scanning) {
          if (
            observedWorkRef.current &&
            status.completed &&
            ((status.written || 0) > 0 || (status.failed || 0) > 0)
          ) {
            const notify = status.failed ? toast.warn : toast.success;
            notify(
              `Enrichment finished — ${status.written} updated, ${status.failed} failed.`,
            );
          }

          observedWorkRef.current = false;
        }
      } catch {
        if (active) setScanStatus(null);
      } finally {
        if (active) timer = setTimeout(poll, 8_000);
      }
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  if (!hasActiveWork(scanStatus)) return null;
  const percent = Math.round(
    Math.min(1, Math.max(0, Number(scanStatus.progress) || 0)) * 100,
  );
  return (
    <div
      className="status-strip-item enrichment-status"
      role="status"
      title={`Metadata enrichment: ${scanStatus.written} updated, ${scanStatus.skipped} skipped, ${scanStatus.failed} failed. Music playback and Soulseek remain available.`}
    >
      <Loader2
        className="status-icon status-spin"
        size={13}
      />
      <span>{`Enrichment ${percent}%`}</span>
      {scanStatus.total > 0 && (
        <span>
          {Math.min(
            scanStatus.total,
            (scanStatus.written || 0) +
              (scanStatus.skipped || 0) +
              (scanStatus.failed || 0),
          )}
          /{scanStatus.total} tracks
        </span>
      )}
    </div>
  );
};

export default MetadataLookupWatcher;
