// <copyright file="LimiterView.jsx" company="John Narey">
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

import {
  CEILING_MAX_DB,
  CEILING_MIN_DB,
  RELEASE_MAX_SECONDS,
  RELEASE_MIN_SECONDS,
} from '../../lib/dsp/LimiterProcessor';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import ProcessorRow from './ProcessorRow';
import React, { useEffect, useRef, useState } from 'react';

// Standalone Limiter panel — the same instance Performance Mode's "Output
// Protection" toggle drives. It's a final safety stage, not a mix-bus
// compressor: only Ceiling and Release are exposed, see
// lib/dsp/LimiterProcessor.js for why attack/knee/ratio stay fixed.
const LimiterView = ({
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.dsp.limiter.enabled', false),
  );
  const [ceiling, setCeiling] = useState(() =>
    prefs.get('mediaPlayer.dsp.limiter.ceiling', -1),
  );
  const [release, setRelease] = useState(() =>
    prefs.get('mediaPlayer.dsp.limiter.release', 0.1),
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

    const processor = getMediaAudioGraph(audio).dsp.limiter;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setCeiling(snapshot.ceiling);
      setRelease(snapshot.release);
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
      prefs.set('mediaPlayer.dsp.limiter.enabled', next);
      return next;
    });
  };

  const changeCeiling = (event) => {
    const next = Number.parseFloat(event.target.value);
    setCeiling(next);
    processorRef.current?.setCeiling(next);
    prefs.set('mediaPlayer.dsp.limiter.ceiling', next);
  };

  const changeRelease = (event) => {
    const next = Number.parseFloat(event.target.value);
    setRelease(next);
    processorRef.current?.setRelease(next);
    prefs.set('mediaPlayer.dsp.limiter.release', next);
  };

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="Limiter"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">Limiter</span>
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
          Final output ceiling. Built on a DynamicsCompressorNode at the
          browser&apos;s maximum ratio — the closest a stock Web Audio node gets
          to a brick-wall limiter, not a true lookahead limiter.
        </p>

        <label className="mp-processing-setting">
          <span>Ceiling</span>
          <input
            className="mp-processing-slider"
            max={CEILING_MAX_DB}
            min={CEILING_MIN_DB}
            onChange={changeCeiling}
            step={0.1}
            type="range"
            value={ceiling}
          />
          <span className="mp-processing-setting-value">
            {ceiling.toFixed(1)} dBFS
          </span>
        </label>
        <label className="mp-processing-setting">
          <span>Release</span>
          <input
            className="mp-processing-slider"
            max={RELEASE_MAX_SECONDS}
            min={RELEASE_MIN_SECONDS}
            onChange={changeRelease}
            step={0.01}
            type="range"
            value={release}
          />
          <span className="mp-processing-setting-value">
            {Math.round(release * 1_000)} ms
          </span>
        </label>
      </div>
    </ProcessorRow>
  );
};

export default LimiterView;
