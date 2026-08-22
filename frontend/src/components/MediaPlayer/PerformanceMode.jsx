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
import { PerformanceAudioProcessor } from '../../lib/PerformanceAudioProcessor';
import * as prefs from '../../lib/prefs';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One entry in the Processing modal (see AudioProcessing.jsx, which mounts
// this and any future processors as siblings) — DJ-style compression,
// output limiting and loudness levelling. Fully self-contained: owns its
// own PerformanceAudioProcessor lifecycle and persisted settings.
// AudioProcessing knows nothing about compressors or limiters — it just
// renders this component's list row on the left, portals its settings into
// the right-hand pane when selected, and reads back whether it's on via
// onActiveChange.
const PerformanceMode = ({
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
    prefs.get('mediaPlayer.performanceCompression', 0.5),
  );
  const [protection, setProtection] = useState(() =>
    prefs.get('mediaPlayer.performanceProtection', true),
  );
  const [normalize, setNormalize] = useState(() =>
    prefs.get('mediaPlayer.performanceNormalize', true),
  );

  // Attach a processor to this <audio> element's shared graph. Built once
  // per mount and torn down (bypassed, not destroyed — see
  // PerformanceAudioProcessor.dispose) on unmount; the enabled/compression/
  // protection/normalize effects below push state into it as the user
  // changes them, without recreating it. Mounted for as long as the player
  // has a track loaded, independent of whether the Processing modal is
  // open or which item is selected — neither may silently disable this.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const graph = getMediaAudioGraph(audio);
    const processor = new PerformanceAudioProcessor(graph);
    processorRef.current = processor;
    processor.setCompressionAmount(compression);
    processor.setOutputProtection(protection);
    processor.setLoudnessNormalize(normalize, targetLufs);
    processor.setEnabled(enabled);

    return () => {
      processor.dispose();
      processorRef.current = null;
    };
    // Only the element identity should rebuild the processor — the
    // parameter effects below handle every other change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRef]);

  useEffect(() => {
    processorRef.current?.setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    processorRef.current?.setCompressionAmount(compression);
  }, [compression]);

  useEffect(() => {
    processorRef.current?.setOutputProtection(protection);
  }, [protection]);

  useEffect(() => {
    processorRef.current?.setLoudnessNormalize(normalize, targetLufs);
  }, [normalize, targetLufs]);

  useEffect(() => {
    onActiveChange?.(enabled);
    return () => onActiveChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const toggleEnabled = (event) => {
    event.stopPropagation();
    setEnabled((previous) => {
      const next = !previous;
      prefs.set('mediaPlayer.performanceMode', next);
      return next;
    });
  };

  const changeCompression = (event) => {
    const next = Number.parseInt(event.target.value, 10) / 100;
    setCompression(next);
    prefs.set('mediaPlayer.performanceCompression', next);
  };

  const toggleProtection = () => {
    setProtection((previous) => {
      const next = !previous;
      prefs.set('mediaPlayer.performanceProtection', next);
      return next;
    });
  };

  const toggleNormalize = () => {
    setNormalize((previous) => {
      const next = !previous;
      prefs.set('mediaPlayer.performanceNormalize', next);
      return next;
    });
  };

  return (
    <>
      <div
        className={`mp-processing-row${isSelected ? ' mp-processing-row--selected' : ''}`}
        onClick={onSelect}
      >
        <span className="mp-processing-row-name">Performance Mode</span>
        <input
          checked={enabled}
          onChange={toggleEnabled}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
      </div>

      {isSelected &&
        detailContainerNode &&
        createPortal(
          <div className="mp-processing-detail">
            <div className="mp-processing-detail-header">
              <span className="mp-processing-detail-title">
                Performance Mode
              </span>
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
              DJ-style compression, output limiting and loudness levelling —
              reduces jumps in perceived volume between tracks and protects
              against clipping.
            </p>

            <label className="mp-processing-setting">
              <span>Compression</span>
              <input
                className="mp-processing-slider"
                max={100}
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
          </div>,
          detailContainerNode,
        )}
    </>
  );
};

export default PerformanceMode;
