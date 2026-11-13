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

import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import React, { useEffect, useRef } from 'react';

// Momentary loudness range shown on the meter, in LUFS. -40 is roughly silent
// programme material, 0 is full-scale (clipping) — real mixes rarely get near 0.
const METER_MIN_LUFS = -40;
const METER_MAX_LUFS = 0;

// The bar on its own says nothing about what full means — 0 LUFS is digital
// full scale, which a real master never reaches, so "nearly full" is the
// useful landmark rather than the top of the scale. Newlines render in a title
// attribute, so the whole measurement fits without any extra chrome in a bar
// that has no room for it.
const describe = (loudness) => {
  const scale = `Live momentary loudness · ${METER_MAX_LUFS} LUFS is full scale, meter floor ${METER_MIN_LUFS}`;
  if (!loudness) return `${scale}\nThis track has not been analysed yet`;

  return [
    scale,
    `Integrated: ${loudness.integratedLufs?.toFixed(1)} LUFS (the track's overall level)`,
    `Range: ${loudness.loudnessRange?.toFixed(1)} LU (quiet-to-loud spread)`,
    `True peak: ${loudness.truePeak?.toFixed(1)} dBTP (above 0 clips)`,
  ].join('\n');
};

// Live LUFS-style loudness meter, fed by the actual <audio> element via the
// Web Audio API, plus the track's cached integrated LUFS (fetched by the
// parent, see useTrackLoudness) as a static reference number. Approximates
// ITU-R BS.1770 K-weighting with two BiquadFilterNodes (high-pass +
// high-shelf) rather than the spec's exact filter coefficients — close
// enough for a live visual meter, not a broadcast-certified measurement.
//
// Purely a display — the analyser it reads taps the graph upstream of any
// gain/Performance Mode processing (see mediaAudioGraph.js), so it always
// shows the track's real level. Volume/loudness adjustment itself lives in
// Performance Mode now (PerformanceMode.jsx).
const LoudnessMeter = ({
  audioRef,
  loudness,
  orientation = 'horizontal',
  showLive = false,
}) => {
  const fillRef = useRef(null);
  const labelRef = useRef(null);
  const analyserRef = useRef(null);
  const bufferRef = useRef(null);
  const staticLufs = Number.isFinite(loudness?.integratedLufs)
    ? loudness.integratedLufs
    : null;
  // The redraw loop is started once and never restarted (it reads everything
  // through refs), so it can't close over the current track's loudness.
  const hasIntegratedRef = useRef(false);
  hasIntegratedRef.current = staticLufs != null;
  const showLiveRef = useRef(showLive);
  showLiveRef.current = showLive;
  const verticalRef = useRef(orientation === 'vertical');
  verticalRef.current = orientation === 'vertical';

  // Attach to the shared audio graph for this <audio> element. Built lazily
  // and cached on the element itself by getMediaAudioGraph — see that
  // module for why it can't just be built fresh per mount.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const graph = getMediaAudioGraph(audio);
    analyserRef.current = graph.analyser;
    bufferRef.current = graph.analyserBuffer;

    if (graph.context.state !== 'suspended') return undefined;

    // This mount (triggered by restoring playback state on load, not an
    // actual click) is NOT a user gesture, so the browser blocks resume()
    // here — and since createMediaElementSource has already permanently
    // rerouted this element's entire audio output through this context,
    // never retrying would mean the track stays silent forever. Retry on
    // the first genuine click/keypress/touch anywhere on the page instead.
    const tryResume = () => {
      void graph.context.resume();
    };

    tryResume();
    const meterDocument = fillRef.current?.ownerDocument || document;
    const gestureEvents = ['click', 'keydown', 'touchstart'];
    for (const eventName of gestureEvents) {
      meterDocument.addEventListener(eventName, tryResume, { once: true });
    }

    return () => {
      for (const eventName of gestureEvents) {
        meterDocument.removeEventListener(eventName, tryResume);
      }
    };
  }, [audioRef]);

  useEffect(() => {
    const meterWindow = fillRef.current?.ownerDocument.defaultView || window;
    let frameId;
    let lastUpdate = 0;
    const loop = (now) => {
      frameId = meterWindow.requestAnimationFrame(loop);

      // A loudness bar doesn't need true 60fps precision like the waveform's
      // scrub position does — updating it ~15x/sec still looks smooth to the
      // eye, and skipping the other ~45 frames/sec frees up main-thread time
      // that was competing with the waveform's own rAF loop for the same
      // 16ms frame budget (that contention was making the waveform stutter).
      if (now - lastUpdate < 65) return;
      lastUpdate = now;

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
        fillRef.current.style.width = verticalRef.current ? '100%' : `${pct}%`;
        fillRef.current.style.height = verticalRef.current ? `${pct}%` : '100%';
        fillRef.current.style.background =
          pct > 85
            ? '#ff4d4d'
            : pct > 65
              ? '#ffb84d'
              : 'var(--art-accent, #4d9fff)';
        const meter = fillRef.current.parentElement;
        meter.setAttribute('aria-valuenow', clamped.toFixed(1));
        meter.setAttribute('aria-valuetext', `${clamped.toFixed(1)} LUFS`);

        // The live meter shows LUFS; the compact bar keeps its integrated
        // reference when available. Avoid re-rendering the player
        // for this visual update, which runs about 15 times per second.
        if (
          labelRef.current &&
          (showLiveRef.current || !hasIntegratedRef.current)
        ) {
          labelRef.current.textContent = `live ${clamped.toFixed(1)} LUFS`;
        }
      }
    };

    frameId = meterWindow.requestAnimationFrame(loop);
    return () => meterWindow.cancelAnimationFrame(frameId);
  }, []);

  return (
    <div
      className={`mp-loudness-meter${showLive ? ' mp-loudness-meter--live' : ''}${orientation === 'vertical' ? ' mp-loudness-meter--vertical' : ''}`}
      title={describe(loudness)}
    >
      <div
        aria-label="Live momentary loudness"
        aria-valuemax={METER_MAX_LUFS}
        aria-valuemin={METER_MIN_LUFS}
        aria-valuenow={METER_MIN_LUFS}
        className="mp-loudness-meter-track"
        role="meter"
      >
        <div
          className="mp-loudness-meter-fill"
          ref={fillRef}
        />
      </div>
      {/* The track's overall (integrated) level once it has been analysed —
          that is the figure worth reading, and it only changes per track, so
          React owns the text. Until then the redraw loop fills the same span
          with the live momentary reading, so the meter is never blank; the
          prefix says which of the two you are looking at. */}
      <span
        className="mp-loudness-meter-label"
        ref={labelRef}
      >
        {showLive
          ? 'live – LUFS'
          : staticLufs == null
            ? '–'
            : `avg ${staticLufs.toFixed(1)} LUFS`}
      </span>
    </div>
  );
};

export default LoudnessMeter;
