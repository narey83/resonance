// <copyright file="EqView.jsx" company="John Narey">
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

import { EQ_MAX_DB, EQ_MIN_DB } from '../../lib/dsp/EqProcessor';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import ProcessorRow from './ProcessorRow';
import React, { useEffect, useRef, useState } from 'react';

// 3-band EQ panel — see lib/dsp/EqProcessor.js for the underlying filters.
const EqView = ({
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.dsp.eq.enabled', false),
  );
  const [low, setLow] = useState(() => prefs.get('mediaPlayer.dsp.eq.low', 0));
  const [mid, setMid] = useState(() => prefs.get('mediaPlayer.dsp.eq.mid', 0));
  const [high, setHigh] = useState(() =>
    prefs.get('mediaPlayer.dsp.eq.high', 0),
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

    const processor = getMediaAudioGraph(audio).dsp.eq;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setLow(snapshot.low);
      setMid(snapshot.mid);
      setHigh(snapshot.high);
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
      prefs.set('mediaPlayer.dsp.eq.enabled', next);
      return next;
    });
  };

  const band = (label, value, setValue, setProcessor, prefKey) => (
    <label
      className="mp-processing-setting"
      key={label}
    >
      <span>{label}</span>
      <input
        className="mp-processing-slider"
        max={EQ_MAX_DB}
        min={EQ_MIN_DB}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          setValue(next);
          setProcessor(next);
          prefs.set(prefKey, next);
        }}
        step={0.5}
        type="range"
        value={value}
      />
      <span className="mp-processing-setting-value">
        {value > 0 ? '+' : ''}
        {value.toFixed(1)} dB
      </span>
    </label>
  );

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="EQ"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">EQ</span>
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
          3-band music EQ — low shelf, mid peaking, high shelf.
        </p>

        {band(
          'Low',
          low,
          setLow,
          (v) => processorRef.current?.setLow(v),
          'mediaPlayer.dsp.eq.low',
        )}
        {band(
          'Mid',
          mid,
          setMid,
          (v) => processorRef.current?.setMid(v),
          'mediaPlayer.dsp.eq.mid',
        )}
        {band(
          'High',
          high,
          setHigh,
          (v) => processorRef.current?.setHigh(v),
          'mediaPlayer.dsp.eq.high',
        )}
      </div>
    </ProcessorRow>
  );
};

export default EqView;
