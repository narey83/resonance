// <copyright file="SaturationView.jsx" company="John Narey">
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

import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import ProcessorRow from './ProcessorRow';
import React, { useEffect, useRef, useState } from 'react';

// Subtle harmonic saturation panel — see lib/dsp/SaturationProcessor.js.
const SaturationView = ({
  advanced = false,
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.dsp.saturation.enabled', false),
  );
  const [amount, setAmount] = useState(() =>
    prefs.get('mediaPlayer.dsp.saturation.amount', 0.05),
  );

  // Params/enabled are restored once, centrally, when the graph is built
  // (see mediaAudioGraph.js's restorePersistedState) — this just attaches
  // to the already-initialized processor and mirrors its live state,
  // rather than pushing this panel's own persisted values over whatever
  // is already there (which could stomp a value Performance Mode or a
  // preset just set).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const processor = getMediaAudioGraph(audio).dsp.saturation;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setAmount(snapshot.amount);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRef]);

  useEffect(() => {
    onActiveChange?.(enabled);
    return () => onActiveChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const toggleEnabled = (event) => {
    event?.stopPropagation();
    setEnabled((previous) => {
      const next = !previous;
      processorRef.current?.setEnabled(next);
      prefs.set('mediaPlayer.dsp.saturation.enabled', next);
      return next;
    });
  };

  const changeAmount = (event) => {
    const next = Number.parseInt(event.target.value, 10) / 100;
    setAmount(next);
    processorRef.current?.setAmount(next);
    prefs.set('mediaPlayer.dsp.saturation.amount', next);
  };

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="Saturation"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">Saturation</span>
          <label className="mp-processing-detail-enable">
            <input
              checked={enabled}
              onChange={toggleEnabled}
              type="checkbox"
            />
            <span>{enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <p className="mp-processing-detail-description">
          Subtle harmonic warmth via soft-clip saturation, mixed with the dry
          signal rather than replacing it. Meant to be felt, not heard as
          distortion.
        </p>

        <label className="mp-processing-setting">
          <span>Amount</span>
          <input
            className="mp-processing-slider"
            max={advanced ? 100 : 10}
            min={0}
            onChange={changeAmount}
            type="range"
            value={Math.round(amount * 100)}
          />
        </label>
      </div>
    </ProcessorRow>
  );
};

export default SaturationView;
