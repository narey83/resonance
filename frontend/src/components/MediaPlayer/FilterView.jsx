// <copyright file="FilterView.jsx" company="John Narey">
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

import { RESONANCE_MAX, RESONANCE_MIN } from '../../lib/dsp/FilterProcessor';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import ProcessorRow from './ProcessorRow';
import React, { useEffect, useRef, useState } from 'react';

// DJ-style sweep filter panel — see lib/dsp/FilterProcessor.js. Position
// -1 sweeps a rising highpass, +1 a falling lowpass, 0 is wide open.
const FilterView = ({
  advanced = false,
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.dsp.filter.enabled', false),
  );
  const [position, setPosition] = useState(() =>
    prefs.get('mediaPlayer.dsp.filter.position', 0),
  );
  const [resonance, setResonance] = useState(() =>
    prefs.get('mediaPlayer.dsp.filter.resonance', 1),
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

    const processor = getMediaAudioGraph(audio).dsp.filter;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setPosition(snapshot.position);
      setResonance(snapshot.resonance);
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
      prefs.set('mediaPlayer.dsp.filter.enabled', next);
      return next;
    });
  };

  const changePosition = (event) => {
    const next = Number.parseInt(event.target.value, 10) / 100;
    setPosition(next);
    processorRef.current?.setPosition(next);
    prefs.set('mediaPlayer.dsp.filter.position', next);
  };

  const changeResonance = (event) => {
    const next = Number.parseFloat(event.target.value);
    setResonance(next);
    processorRef.current?.setResonance(next);
    prefs.set('mediaPlayer.dsp.filter.resonance', next);
  };

  const positionLabel =
    position < -0.02
      ? `High Pass · ${Math.round(-position * 100)}%`
      : position > 0.02
        ? `Low Pass · ${Math.round(position * 100)}%`
        : 'Open';

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="Filter"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">Filter</span>
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
          One-knob DJ sweep filter — left of centre sweeps a rising high pass,
          right sweeps a falling low pass.
        </p>

        <label className="mp-processing-setting">
          <span>Low ◂ Filter ▸ High</span>
          <input
            className="mp-processing-slider"
            max={advanced ? 100 : 10}
            min={advanced ? -100 : -10}
            onChange={changePosition}
            type="range"
            value={Math.round(position * 100)}
          />
          <span className="mp-processing-setting-value">{positionLabel}</span>
        </label>
        {advanced && (
          <label className="mp-processing-setting">
            <span>Resonance</span>
            <input
              className="mp-processing-slider"
              max={RESONANCE_MAX}
              min={RESONANCE_MIN}
              onChange={changeResonance}
              step={0.1}
              type="range"
              value={resonance}
            />
          </label>
        )}
      </div>
    </ProcessorRow>
  );
};

export default FilterView;
