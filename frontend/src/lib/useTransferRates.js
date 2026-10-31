// <copyright file="StatusStrip.jsx" company="John Narey">
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

import { useEffect, useRef, useState } from 'react';

const useTransferRates = (downloads, uploads) => {
  // Instantaneous transfer throughput. The API's averageSpeed is a lifetime
  // average (total bytes ÷ the transfer's whole lifetime), so summing it makes
  // the header wildly over-report: a completed-but-not-yet-cleared transfer keeps
  // contributing its old average even though nothing is moving. Instead we derive
  // the true current rate from how many bytes actually moved since the last poll.
  const [rates, setRates] = useState({ down: 0, up: 0 });
  const prevBytesRef = useRef({
    down: new Map(),
    t: Date.now(),
    up: new Map(),
  });

  useEffect(() => {
    const now = Date.now();
    const elapsed = (now - prevBytesRef.current.t) / 1_000;

    // Guard against rapid double-fires (elapsed too small → divide-by-near-zero
    // spikes); keep the previous sample so the next real poll spans a full window.
    if (elapsed < 0.5) {
      return;
    }

    const rate = (list, prevMap) => {
      const nextMap = new Map();
      let delta = 0;
      for (const t of Array.isArray(list) ? list : []) {
        const bytes = t.bytesTransferred ?? 0;
        nextMap.set(t.id, bytes);
        const prev = prevMap.get(t.id);

        if (prev != null && bytes > prev) {
          delta += bytes - prev;
        }
      }

      return { bytesPerSecond: delta / elapsed, nextMap };
    };

    const down = rate(downloads, prevBytesRef.current.down);
    const up = rate(uploads, prevBytesRef.current.up);
    prevBytesRef.current = { down: down.nextMap, t: now, up: up.nextMap };
    setRates({ down: down.bytesPerSecond, up: up.bytesPerSecond });
  }, [downloads, uploads]);

  return rates;
};

export default useTransferRates;
