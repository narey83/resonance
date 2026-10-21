// <copyright file="PerformanceMode.jsx" company="John Narey">
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

// One entry in the Processing modal — a one-switch "DJ-style compression,
// output limiting and loudness levelling" bundle. Unlike the other
// processor views, this one is an orchestrator: it doesn't own Web Audio
// nodes of its own, it drives the shared PerformanceProcessor (see
// lib/dsp/PerformanceProcessor.js), which in turn enables/configures the
// same Compressor and Limiter instances the standalone Compressor/Limiter
// panels show — one processor, not two competing ones.
const PerformanceMode = ({
  advanced = false,
  audioRef,
  detailContainerNode,
  isSelected,
  onActiveChange,
  onSelect,
  targetLufs,
}) => {
  const processorRef = useRef(null);
  const [enabled, setEnabled] = useState(() =>
    prefs.get('mediaPlayer.performanceMode', false),
  );
  const [compression, setCompression] = useState(() =>
    prefs.get('mediaPlayer.performanceCompression', 0.15),
  );
  const [protection, setProtection] = useState(() =>
    prefs.get('mediaPlayer.performanceProtection', true),
  );
  const [normalize, setNormalize] = useState(() =>
    prefs.get('mediaPlayer.performanceNormalize', true),
  );

  // Params/enabled are restored once, centrally, when the graph is built
  // (see mediaAudioGraph.js's restorePersistedState) — this just attaches
  // to the already-initialized processor and mirrors its live state.
  // Subscribing matters here specifically because presets.js can flip this
  // processor's enabled/amount/protection directly (see presets.js) — this
  // is what keeps the checkbox honest when that happens.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const processor = getMediaAudioGraph(audio).dsp.performance;
    processorRef.current = processor;

    return processor.subscribe((snapshot) => {
      setEnabled(snapshot.enabled);
      setCompression(snapshot.compressionAmount);
      setProtection(snapshot.protectionEnabled);
      setNormalize(snapshot.normalizeEnabled);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRef]);

  useEffect(
    () => () => processorRef.current?.dispose(),
    // Bypass on unmount (track cleared, cast connected) — see
    // PerformanceProcessor.dispose(). Runs once, on unmount only.
    [],
  );

  useEffect(() => {
    processorRef.current?.setLoudnessNormalize(normalize, targetLufs);
    // Only targetLufs needs to be reactive here — it changes on every
    // track change independent of any user action. `normalize` itself is
    // pushed directly from toggleNormalize below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLufs]);

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
      prefs.set('mediaPlayer.performanceMode', next);
      return next;
    });
  };

  const changeCompression = (event) => {
    const next = Number.parseInt(event.target.value, 10) / 100;
    setCompression(next);
    processorRef.current?.setCompressionAmount(next);
    prefs.set('mediaPlayer.performanceCompression', next);
  };

  const toggleProtection = () => {
    setProtection((previous) => {
      const next = !previous;
      processorRef.current?.setOutputProtection(next);
      prefs.set('mediaPlayer.performanceProtection', next);
      return next;
    });
  };

  const toggleNormalize = () => {
    setNormalize((previous) => {
      const next = !previous;
      processorRef.current?.setLoudnessNormalize(next, targetLufs);
      prefs.set('mediaPlayer.performanceNormalize', next);
      return next;
    });
  };

  return (
    <ProcessorRow
      detailContainerNode={detailContainerNode}
      enabled={enabled}
      isSelected={isSelected}
      name="Performance Mode"
      onSelect={onSelect}
      onToggleEnabled={toggleEnabled}
    >
      <div className="mp-processing-detail">
        <div className="mp-processing-detail-header">
          <span className="mp-processing-detail-title">Performance Mode</span>
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
          DJ-style compression, output limiting and loudness levelling — reduces
          jumps in perceived volume between tracks and protects against
          clipping. Drives the Compressor and Limiter below rather than a
          separate copy of them.
        </p>

        <label className="mp-processing-setting">
          <span>Compression</span>
          <input
            className="mp-processing-slider"
            max={advanced ? 100 : 25}
            min={0}
            onChange={changeCompression}
            type="range"
            value={Math.round(compression * 100)}
          />
        </label>
        <label className="mp-processing-setting mp-processing-setting--toggle">
          <span>Output Protection</span>
          <input
            checked={protection}
            onChange={toggleProtection}
            type="checkbox"
          />
        </label>
        <label className="mp-processing-setting mp-processing-setting--toggle">
          <span>Loudness Normalise</span>
          <input
            checked={normalize}
            onChange={toggleNormalize}
            type="checkbox"
          />
        </label>
      </div>
    </ProcessorRow>
  );
};

export default PerformanceMode;
