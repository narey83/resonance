// <copyright file="CompressorView.jsx" company="John Narey">
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
  ATTACK_MAX_SECONDS,
  ATTACK_MIN_SECONDS,
  RELEASE_MAX_SECONDS,
  RELEASE_MIN_SECONDS,
} from '../../lib/dsp/CompressorProcessor';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import ProcessorRow from './ProcessorRow';
import React, { useEffect, useRef, useState } from 'react';

// Standalone Compressor panel. Drives the SAME CompressorProcessor
// instance Performance Mode's "Compression" slider drives (see
// lib/dsp/PerformanceProcessor.js) — there is only one compressor in the
// rack, not one per panel.
const CompressorView = ({
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.dsp.compressor.enabled', false),
  );
  const [amount, setAmount] = useState(() =>
    prefs.get('mediaPlayer.dsp.compressor.amount', 0.5),
  );
  const [attack, setAttack] = useState(() =>
    prefs.get('mediaPlayer.dsp.compressor.attack', 0.01),
  );
  const [release, setRelease] = useState(() =>
    prefs.get('mediaPlayer.dsp.compressor.release', 0.2),
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

    const processor = getMediaAudioGraph(audio).dsp.compressor;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setAmount(snapshot.amount);
      setAttack(snapshot.attack);
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
      prefs.set('mediaPlayer.dsp.compressor.enabled', next);
      return next;
    });
  };

  const changeAmount = (event) => {
    const next = Number.parseInt(event.target.value, 10) / 100;
    setAmount(next);
    processorRef.current?.setAmount(next);
    prefs.set('mediaPlayer.dsp.compressor.amount', next);
  };

  const changeAttack = (event) => {
    const next = Number.parseFloat(event.target.value);
    setAttack(next);
    processorRef.current?.setAttack(next);
    prefs.set('mediaPlayer.dsp.compressor.attack', next);
  };

  const changeRelease = (event) => {
    const next = Number.parseFloat(event.target.value);
    setRelease(next);
    processorRef.current?.setRelease(next);
    prefs.set('mediaPlayer.dsp.compressor.release', next);
  };

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="Compressor"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">Compressor</span>
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
          Narrows dynamic range with automatic make-up gain, so turning it up
          doesn&apos;t quietly turn the track down.
        </p>

        <label className="mp-processing-setting">
          <span>Amount</span>
          <input
            className="mp-processing-slider"
            max={100}
            min={0}
            onChange={changeAmount}
            type="range"
            value={Math.round(amount * 100)}
          />
        </label>
        <label className="mp-processing-setting">
          <span>Attack</span>
          <input
            className="mp-processing-slider"
            max={ATTACK_MAX_SECONDS}
            min={ATTACK_MIN_SECONDS}
            onChange={changeAttack}
            step={0.001}
            type="range"
            value={attack}
          />
          <span className="mp-processing-setting-value">
            {Math.round(attack * 1_000)} ms
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

export default CompressorView;
