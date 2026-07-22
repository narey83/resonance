// <copyright file="LoudnessMeter.jsx" company="John Narey">
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

import api from '../../lib/api';
import * as prefs from '../../lib/prefs';
import React, { useEffect, useRef, useState } from 'react';

// Momentary loudness range shown on the meter, in LUFS. -40 is roughly silent
// programme material, 0 is full-scale (clipping) — real mixes rarely get near 0.
const METER_MIN_LUFS = -40;
const METER_MAX_LUFS = 0;

// -14 LUFS is the common streaming-loudness target (Spotify/YouTube Music
// default to around this). Clamped so a very quiet or very loud outlier track
// doesn't get boosted/cut to an extreme that either clips or guts it.
const TARGET_LUFS = -14;
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = 12;
// Smooth the gain change over ~80ms instead of stepping instantly — an instant
// jump (e.g. right when a new track's LUFS value loads) is an audible click.
const GAIN_RAMP_SECONDS = 0.08;

// Live LUFS-style loudness meter, fed by the actual <audio> element via the
// Web Audio API, plus the track's cached integrated LUFS as a static reference
// number. Approximates ITU-R BS.1770 K-weighting with two BiquadFilterNodes
// (high-pass + high-shelf) rather than the spec's exact filter coefficients —
// close enough for a live visual meter, not a broadcast-certified measurement.
const LoudnessMeter = ({ audioRef, track }) => {
  const fillRef = useRef(null);
  const analyserRef = useRef(null);
  const bufferRef = useRef(null);
  const gainNodeRef = useRef(null);
  const audioContextRef = useRef(null);
  const [staticLufs, setStaticLufs] = useState(null);
  const [normalize, setNormalize] = useState(() =>
    prefs.get('mediaPlayer.lufsNormalize', false),
  );

  useEffect(() => {
    setStaticLufs(null);
    if (!track?.path) return undefined;

    let cancelled = false;
    api
      .get('/loudness', { params: { path: track.path } })
      .then(({ data }) => {
        if (!cancelled) setStaticLufs(data.integratedLufs);
      })
      .catch(() => {
        /* no cached loudness yet — static reference just stays hidden */
      });

    return () => {
      cancelled = true;
    };
  }, [track?.path]);

  // Build the analysis graph once per <audio> element's lifetime —
  // createMediaElementSource throws if called more than once on the same
  // element, so this must not re-run on track change.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audio);

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 60;

    const highshelf = context.createBiquadFilter();
    highshelf.type = 'highshelf';
    highshelf.frequency.value = 1_500;
    highshelf.gain.value = 4;

    const analyser = context.createAnalyser();
    analyser.fftSize = 16_384;
    analyser.smoothingTimeConstant = 0;

    // Loudness-normalisation gain sits in the actual playback path (not just
    // the analysis path) — this is what makes normalisation audible, as
    // opposed to the meter, which only reads the signal.
    const gainNode = context.createGain();
    gainNode.gain.value = 1;

    // The element's own output was implicitly disconnected the moment
    // createMediaElementSource ran, so playback needs its own explicit path
    // to the speakers, entirely separate from the filtered analysis path.
    source.connect(gainNode);
    gainNode.connect(context.destination);
    source.connect(highpass);
    highpass.connect(highshelf);
    highshelf.connect(analyser);

    analyserRef.current = analyser;
    bufferRef.current = new Float32Array(analyser.fftSize);
    gainNodeRef.current = gainNode;
    audioContextRef.current = context;

    return () => {
      analyserRef.current = null;
      gainNodeRef.current = null;
      audioContextRef.current = null;
      source.disconnect();
      void context.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retarget the normalisation gain whenever the track's LUFS value loads (or
  // changes) or the user toggles normalisation — ramped, not stepped, so
  // neither event produces an audible click.
  useEffect(() => {
    const gainNode = gainNodeRef.current;
    const context = audioContextRef.current;
    if (!gainNode || !context) return;

    let targetGain = 1;
    if (normalize && staticLufs != null) {
      const gainDb = Math.max(
        -MAX_CUT_DB,
        Math.min(MAX_BOOST_DB, TARGET_LUFS - staticLufs),
      );
      targetGain = 10 ** (gainDb / 20);
    }

    gainNode.gain.setTargetAtTime(
      targetGain,
      context.currentTime,
      GAIN_RAMP_SECONDS,
    );
  }, [normalize, staticLufs]);

  const toggleNormalize = () => {
    setNormalize((previous) => {
      const next = !previous;
      prefs.set('mediaPlayer.lufsNormalize', next);
      return next;
    });
  };

  useEffect(() => {
    let frameId;
    const loop = () => {
      const analyser = analyserRef.current;
      const buffer = bufferRef.current;
      if (analyser && buffer && fillRef.current) {
        analyser.getFloatTimeDomainData(buffer);
        let sumSquares = 0;
        for (const sample of buffer) sumSquares += sample * sample;
        const meanSquare = sumSquares / buffer.length;
        const momentaryLufs =
          meanSquare > 0
            ? -0.691 + 10 * Math.log10(meanSquare)
            : METER_MIN_LUFS;
        const clamped = Math.max(
          METER_MIN_LUFS,
          Math.min(METER_MAX_LUFS, momentaryLufs),
        );
        const pct =
          ((clamped - METER_MIN_LUFS) / (METER_MAX_LUFS - METER_MIN_LUFS)) *
          100;
        fillRef.current.style.width = `${pct}%`;
        fillRef.current.style.background =
          pct > 85
            ? '#ff4d4d'
            : pct > 65
              ? '#ffb84d'
              : 'var(--art-accent, #4d9fff)';
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div className="mp-loudness-meter">
      <button
        className={`mp-loudness-normalize-btn${normalize ? ' mp-loudness-normalize-btn--active' : ''}`}
        onClick={toggleNormalize}
        title={`Normalize volume to ${TARGET_LUFS} LUFS across tracks`}
        type="button"
      >
        Norm
      </button>
      <div
        className="mp-loudness-meter-track"
        title={
          staticLufs == null
            ? 'Live loudness (LUFS)'
            : `Live loudness — track averages ${staticLufs.toFixed(1)} LUFS integrated`
        }
      >
        <div
          className="mp-loudness-meter-fill"
          ref={fillRef}
        />
      </div>
      {staticLufs != null && (
        <span className="mp-loudness-meter-label">
          {staticLufs.toFixed(1)} LUFS
        </span>
      )}
    </div>
  );
};

export default LoudnessMeter;
