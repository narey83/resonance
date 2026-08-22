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
import { Settings2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// DJ-style playback control: reduces the perceived-volume jump between
// differently-mastered tracks and stops peaks from clipping. Replaces the
// old standalone "Norm" toggle — Loudness Normalise is now one of three
// stages inside this chain (see PerformanceAudioProcessor) rather than a
// separate control.
const PerformanceMode = ({ audioRef, targetLufs }) => {
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
  const [expanded, setExpanded] = useState(false);

  // Attach a processor to this <audio> element's shared graph. Built once
  // per mount and torn down (bypassed, not destroyed — see
  // PerformanceAudioProcessor.dispose) on unmount; the enabled/compression/
  // protection/normalize effects below push state into it as the user
  // changes them, without recreating it.
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

  const toggleEnabled = () => {
    setEnabled((previous) => {
      const next = !previous;
      prefs.set('mediaPlayer.performanceMode', next);
      if (!next) setExpanded(false);
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
    <div className="mp-performance">
      <button
        className={`mp-performance-btn${enabled ? ' mp-performance-btn--active' : ''}`}
        onClick={toggleEnabled}
        title="Performance Mode: DJ-style compression, output limiting and loudness levelling"
        type="button"
      >
        Performance {enabled ? 'ON' : 'OFF'}
      </button>

      {enabled && (
        <button
          aria-expanded={expanded}
          aria-label="Performance Mode settings"
          className={`mp-performance-settings-btn${expanded ? ' mp-performance-settings-btn--active' : ''}`}
          onClick={() => setExpanded((previous) => !previous)}
          title="Performance Mode settings"
          type="button"
        >
          <Settings2 size={13} />
        </button>
      )}

      {enabled && expanded && (
        <div className="mp-performance-panel">
          <label className="mp-performance-row">
            <span>Compression</span>
            <input
              className="mp-performance-slider"
              max={100}
              min={0}
              onChange={changeCompression}
              type="range"
              value={Math.round(compression * 100)}
            />
          </label>
          <label className="mp-performance-row mp-performance-row--toggle">
            <span>Output Protection</span>
            <input
              checked={protection}
              onChange={toggleProtection}
              type="checkbox"
            />
          </label>
          <label className="mp-performance-row mp-performance-row--toggle">
            <span>Loudness Normalise</span>
            <input
              checked={normalize}
              onChange={toggleNormalize}
              type="checkbox"
            />
          </label>
        </div>
      )}
    </div>
  );
};

export default PerformanceMode;
