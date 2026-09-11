// <copyright file="WaveformAnalysis.jsx" company="John Narey">
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

import './WaveformAnalysis.css';
import { usePlayer } from '../../context/PlayerContext';
import {
  resolveBeatAvailability,
  resolveWaveformDuration,
  timeToPixel,
} from '../../lib/analysisTimeline';
import api from '../../lib/api';
import { getLocalStreamUrl } from '../../lib/files';
import { fuzzyFilter } from '../../lib/fuzzy';
import { getTracks } from '../../lib/musicLibrary';
import {
  beatGridPhase,
  beatGridSeconds,
  visibleBeats,
} from '../../lib/waveform';
import { analyseTrack } from '../Shared/WaveformPreview';
import {
  Activity,
  AudioWaveform,
  BarChart2,
  Download,
  Grid3x3,
  Mountain,
  Music,
  Search,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// eslint-disable-next-line import/no-extraneous-dependencies
import WaveSurfer from 'wavesurfer.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

const getPeaks = (channelData, numberBars) => {
  const samplesPerBar = Math.max(
    1,
    Math.floor(channelData.length / numberBars),
  );
  const peaks = new Float32Array(numberBars);
  for (let barIndex = 0; barIndex < numberBars; barIndex++) {
    let peak = 0;
    const start = barIndex * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    for (let s = start; s < end; s++) {
      const abs = Math.abs(channelData[s]);
      if (abs > peak) peak = abs;
    }

    peaks[barIndex] = peak;
  }

  return peaks;
};

// RMS gives stable bar heights that represent perceived loudness rather than
// the single loudest sample in the window (which varies wildly bar-to-bar).
const getRms = (channelData, numberBars) => {
  const samplesPerBar = Math.max(
    1,
    Math.floor(channelData.length / numberBars),
  );
  const rms = new Float32Array(numberBars);
  for (let b = 0; b < numberBars; b++) {
    let sumSq = 0;
    const start = b * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    for (let s = start; s < end; s++) sumSq += channelData[s] * channelData[s];
    rms[b] = Math.sqrt(sumSq / (end - start));
  }

  return rms;
};

const onePoleLowpass = (data, cutoffHz, sampleRate) => {
  const alpha = 1 / (1 + sampleRate / (2 * Math.PI * cutoffHz));
  const out = new Float32Array(data.length);
  out[0] = data[0] * alpha;
  for (let index = 1; index < data.length; index++) {
    out[index] = out[index - 1] + alpha * (data[index] - out[index - 1]);
  }

  return out;
};

// Simple block-averaging decimator — also acts as a crude anti-alias filter
const downsample = (data, factor) => {
  if (factor <= 1) return data;
  const outLength = Math.floor(data.length / factor);
  const out = new Float32Array(outLength);
  for (let index = 0; index < outLength; index++) {
    let sum = 0;
    const start = index * factor;
    const end = Math.min(start + factor, data.length);
    for (let sample = start; sample < end; sample++) sum += data[sample];
    out[index] = sum / (end - start);
  }

  return out;
};

const computeFrequencyBands = (monoData, sampleRate, numberBars) => {
  // RMS over the full-rate signal: stable, loudness-representative bar heights.
  const overallPeaks = getRms(monoData, numberBars);

  // Frequency analysis uses a downsampled signal.
  // At 44100 Hz a 100 Hz one-pole filter gets alpha ≈ 0.014 — so weak that
  // the bass band barely separates from mid.  Downsampling to ~6 kHz raises
  // alpha to ~0.09, giving real band isolation (kicks → red, hats → blue).
  const dsFactor = Math.max(1, Math.round(sampleRate / 6_000));
  const dsData = downsample(monoData, dsFactor);
  const dsRate = sampleRate / dsFactor;

  const lowFiltered = onePoleLowpass(dsData, 300, dsRate);
  const lowMidFiltered = onePoleLowpass(dsData, 2_000, dsRate);
  const midData = new Float32Array(dsData.length);
  const highData = new Float32Array(dsData.length);
  for (const [index, dsDatum] of dsData.entries()) {
    midData[index] = lowMidFiltered[index] - lowFiltered[index];
    highData[index] = dsDatum - lowMidFiltered[index];
  }

  return {
    lowPeaks: getPeaks(lowFiltered, numberBars),
    midPeaks: getPeaks(midData, numberBars),
    highPeaks: getPeaks(highData, numberBars),
    overallPeaks,
  };
};

const smoothArray = (array, window) => {
  if (window <= 1) return array;
  const half = Math.floor(window / 2);
  const out = new Float32Array(array.length);
  for (let index = 0; index < array.length; index++) {
    let count = 0;
    let sum = 0;
    const lo = Math.max(0, index - half);
    const hi = Math.min(array.length - 1, index + half);
    for (let index_ = lo; index_ <= hi; index_++) {
      sum += array[index_];
      count++;
    }

    out[index] = sum / count;
  }

  return out;
};

const bandMaxima = (_low, _mid, _high, overallPeaks) => {
  let maxOverall = 1e-6;
  for (const overallPeak of overallPeaks) {
    if (overallPeak > maxOverall) maxOverall = overallPeak;
  }

  return { maxOverall };
};

const visibleRange = (totalBars, zoom, scrollFraction) => {
  const visibleBars = Math.ceil(totalBars / zoom);
  const maxStart = Math.max(0, totalBars - visibleBars);
  const startBar = Math.round(scrollFraction * maxStart);
  return {
    startBar,
    endBar: Math.min(startBar + visibleBars, totalBars),
    visibleBars,
  };
};

// ── Draw modes ────────────────────────────────────────────────────────────────

const BASS_COL = '#e02020';
const MID_COL = '#18c840';
const HIGH_COL = '#1858e8';

// Draw stacked segments (red=bass, green=mid, blue=high) mirrored top+bottom
const drawStackedBars = (
  context,
  halfH,
  barFill,
  slotWidth,
  startBar,
  endBar,
  lowPeaks,
  midPeaks,
  highPeaks,
  overallPeaks,
  maxOverall,
  minH = 1,
) => {
  for (let index = startBar; index < endBar; index++) {
    const totalH = Math.max(
      minH,
      Math.round((overallPeaks[index] / maxOverall) ** 0.6 * halfH),
    );
    // Boost bass band so kick transients dominate visually (DJ-style perceptual weighting)
    const wLow = lowPeaks[index] * 1.5;
    const wMid = Number(midPeaks[index]);
    const wHigh = highPeaks[index] * 0.6;
    const bandSum = wLow + wMid + wHigh + 1e-6;
    const lowH = Math.round((totalH * wLow) / bandSum);
    const midH = Math.round((totalH * wMid) / bandSum);
    const highH = totalH - lowH - midH;
    const x = Math.round((index - startBar) * slotWidth);
    // Top half — bass at centre, mids above, highs at tip
    context.fillStyle = BASS_COL;
    context.fillRect(x, halfH - lowH, barFill, lowH);
    context.fillStyle = MID_COL;
    context.fillRect(x, halfH - lowH - midH, barFill, midH);
    context.fillStyle = HIGH_COL;
    context.fillRect(x, halfH - totalH, barFill, highH);
    // Bottom half — mirror
    context.fillStyle = BASS_COL;
    context.fillRect(x, halfH, barFill, lowH);
    context.fillStyle = MID_COL;
    context.fillRect(x, halfH + lowH, barFill, midH);
    context.fillStyle = HIGH_COL;
    context.fillRect(x, halfH + lowH + midH, barFill, highH);
  }
};

// Discrete coloured bars (Serato-style stacked segments)
const drawBars = (
  canvas,
  lowPeaks,
  midPeaks,
  highPeaks,
  overallPeaks,
  zoom,
  scrollFraction,
) => {
  const context = canvas.getContext('2d');
  const halfH = canvas.height / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const { maxOverall } = bandMaxima(
    lowPeaks,
    midPeaks,
    highPeaks,
    overallPeaks,
  );
  const { endBar, startBar, visibleBars } = visibleRange(
    lowPeaks.length,
    zoom,
    scrollFraction,
  );
  const slotWidth = canvas.width / visibleBars;
  const barFill = Math.max(1, Math.round(slotWidth * 0.67));

  drawStackedBars(
    context,
    halfH,
    barFill,
    slotWidth,
    startBar,
    endBar,
    lowPeaks,
    midPeaks,
    highPeaks,
    overallPeaks,
    maxOverall,
    1,
  );
};

// Smooth stacked bars (wider fill, minimum height for quiet sections)
const drawSmooth = (
  canvas,
  lowPeaks,
  midPeaks,
  highPeaks,
  overallPeaks,
  zoom,
  scrollFraction,
) => {
  const context = canvas.getContext('2d');
  const halfH = canvas.height / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const W = 3;
  const sLow = smoothArray(lowPeaks, W);
  const sMid = smoothArray(midPeaks, W);
  const sHigh = smoothArray(highPeaks, W);
  const sOverall = smoothArray(overallPeaks, W);

  const { maxOverall } = bandMaxima(sLow, sMid, sHigh, sOverall);
  const { endBar, startBar, visibleBars } = visibleRange(
    lowPeaks.length,
    zoom,
    scrollFraction,
  );
  const slotWidth = canvas.width / visibleBars;
  const barFill = Math.max(1, Math.round(slotWidth * 0.85));

  drawStackedBars(
    context,
    halfH,
    barFill,
    slotWidth,
    startBar,
    endBar,
    sLow,
    sMid,
    sHigh,
    sOverall,
    maxOverall,
    4,
  );
};

// DAW-style filled silhouette with stacked segments and vertical fade
const drawSilhouette = (
  canvas,
  lowPeaks,
  midPeaks,
  highPeaks,
  overallPeaks,
  zoom,
  scrollFraction,
) => {
  const context = canvas.getContext('2d');
  const halfH = canvas.height / 2;
  const W = canvas.width;
  context.clearRect(0, 0, W, canvas.height);

  const SW = 5;
  const sLow = smoothArray(lowPeaks, SW);
  const sMid = smoothArray(midPeaks, SW);
  const sHigh = smoothArray(highPeaks, SW);
  const sOverall = smoothArray(overallPeaks, SW);

  const { maxOverall } = bandMaxima(sLow, sMid, sHigh, sOverall);
  const { endBar, startBar, visibleBars } = visibleRange(
    lowPeaks.length,
    zoom,
    scrollFraction,
  );
  const slotWidth = W / visibleBars;
  const barFill = Math.ceil(slotWidth) + 1; // edge-to-edge, no gaps

  drawStackedBars(
    context,
    halfH,
    barFill,
    slotWidth,
    startBar,
    endBar,
    sLow,
    sMid,
    sHigh,
    sOverall,
    maxOverall,
    2,
  );

  // Fade top and bottom edges using destination-in composite
  context.globalCompositeOperation = 'destination-in';
  const mask = context.createLinearGradient(0, 0, 0, canvas.height);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.12, 'rgba(0,0,0,1)');
  mask.addColorStop(0.88, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = mask;
  context.fillRect(0, 0, W, canvas.height);
  context.globalCompositeOperation = 'source-over';
};

// Three independent, separately-toggleable layers over the same waveform —
// see WaveformAnalysis's showGhostGrid/showDetectedBeats/showDownbeats state.
// Kept as one function (rather than three) only because they share the same
// time->pixel mapping and canvas save/restore; each layer's own draw/skip
// logic is otherwise self-contained, so adding a fourth (e.g. phrase lines)
// later doesn't touch the other three.
const drawBeatOverlay = (
  canvas,
  {
    beatOffsetSeconds = null,
    beats = null,
    beatsKnown = false,
    bpm,
    downbeatOffsetSeconds = null,
    duration,
    scrollFraction = 0,
    showDetectedBeats = false,
    showDownbeats = false,
    showGhostGrid = true,
    zoom = 1,
  },
) => {
  if (!bpm || !duration) return;
  const context = canvas.getContext('2d');
  const visibleDuration = duration / zoom;
  const startTime = scrollFraction * (duration - visibleDuration);
  const endTime = startTime + visibleDuration;
  const pixelsPerSecond = canvas.width / visibleDuration;
  const secondsPerBeat = 60 / bpm;
  const xAt = (time) =>
    timeToPixel(time - startTime, visibleDuration, canvas.width);

  // Ghost grid: the theoretical clock beatOffsetSeconds/bpm imply — only drawn when a real
  // detected beat offset actually exists (beatsKnown). A BPM tag alone is not beat analysis:
  // rendering this anchored at a fabricated phase of 0 for a track with no real detection
  // previously shipped as a bug. Dashed and low-opacity by design when it does draw — it's a
  // reference to check the detected beats and waveform transients against, not something that
  // should visually compete with them. Widens to bar/phrase spacing at low zoom (same
  // Moiré-avoidance as before) rather than becoming a solid smear.
  if (showGhostGrid && beatsKnown) {
    const lineSeconds = beatGridSeconds(bpm, pixelsPerSecond, 8);
    if (lineSeconds) {
      const phase = beatGridPhase(beatOffsetSeconds, lineSeconds);
      context.save();
      context.strokeStyle = 'rgba(255,255,255,0.22)';
      context.lineWidth = 1;
      context.setLineDash([2, 3]);
      for (let time = phase; time < duration; time += lineSeconds) {
        if (time < startTime || time > endTime) continue;
        const x = Math.round(xAt(time)) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }

      context.restore();
    }
  }

  // Downbeats: stronger line at the heuristic bar boundary (see
  // AudioAnalyzer's downbeat heuristic on the backend) — 4/4 only for now.
  // Skipped below the same legibility floor as the ghost grid so it never
  // becomes a denser comb than the beat grid it's meant to stand out from.
  if (showDownbeats && downbeatOffsetSeconds != null) {
    const barSeconds = secondsPerBeat * 4;
    if (barSeconds * pixelsPerSecond >= 8) {
      const phase = beatGridPhase(downbeatOffsetSeconds, barSeconds);
      context.save();
      context.strokeStyle = 'rgba(255,196,64,0.55)';
      context.lineWidth = 2;
      for (let time = phase; time < duration; time += barSeconds) {
        if (time < startTime || time > endTime) continue;
        const x = Math.round(xAt(time)) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }

      context.restore();
    }
  }

  // Detected beats: Essentia's actual ticks, as short solid markers rather
  // than full-height lines — distinct from the ghost grid's theoretical
  // lines so the two can be visually compared (do they land on top of each
  // other, or is the detector early/late/skipping?). Only drawn once the
  // beat-level grid itself would be legible (not widened to bar/phrase);
  // past that point individual markers would just be a solid bar of ticks.
  if (showDetectedBeats && beats && beats.length) {
    const beatLevelLegible =
      beatGridSeconds(bpm, pixelsPerSecond, 8) <= secondsPerBeat * 1.01;
    if (beatLevelLegible) {
      context.save();
      context.strokeStyle = 'rgba(255,255,255,0.9)';
      context.fillStyle = 'rgba(255,255,255,0.9)';
      context.lineWidth = 1;
      const markerHeight = Math.min(24, canvas.height * 0.2);
      for (const time of visibleBeats(beats, startTime, endTime)) {
        const x = Math.round(xAt(time)) + 0.5;
        context.beginPath();
        context.moveTo(x, canvas.height - markerHeight);
        context.lineTo(x, canvas.height);
        context.stroke();
        context.beginPath();
        context.arc(x, canvas.height - markerHeight, 2.5, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
    }
  }
};

const getTrackLabel = (track) =>
  [
    track.title || track.filename?.split(/[/\\]/u).pop(),
    track.artist,
    track.album,
  ]
    .filter(Boolean)
    .join(' — ');

// ── TrackPicker ───────────────────────────────────────────────────────────────

const TrackPicker = ({ libraryTracks, onSelect, selectedTrack }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const suggestions = useMemo(
    () =>
      query.trim()
        ? fuzzyFilter(query, libraryTracks, getTrackLabel).slice(0, 8)
        : [],
    [libraryTracks, query],
  );

  const handleSelect = (track) => {
    onSelect(track);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="wa-picker">
      <div className="wa-picker-input-wrap">
        <Search
          color="var(--text-muted)"
          size={13}
        />
        <input
          className="wa-picker-input"
          onChange={({ target }) => {
            setQuery(target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            selectedTrack ? getTrackLabel(selectedTrack) : 'Search tracks…'
          }
          ref={inputRef}
          type="text"
          value={query}
        />
        {selectedTrack && !query && (
          <button
            className="wa-picker-clear hover-fx"
            onClick={() => onSelect(null)}
            title="Clear selection"
            type="button"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="wa-picker-dropdown">
          {suggestions.map((track) => (
            <li key={track.path}>
              <button
                className="wa-picker-option"
                onClick={() => handleSelect(track)}
                type="button"
              >
                <Music
                  size={12}
                  style={{ flexShrink: 0 }}
                />
                <span className="wa-picker-option-label">
                  {getTrackLabel(track)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── WaveformAnalysis ──────────────────────────────────────────────────────────

const ZOOM_LEVELS = [1, 2, 4, 8];

const CANVAS_MODES = ['bars', 'smooth', 'silhouette'];

const MODE_META = {
  amplitude: { icon: AudioWaveform, label: 'Amplitude' },
  bars: { icon: BarChart2, label: 'Bars' },
  smooth: { icon: Activity, label: 'Smooth' },
  silhouette: { icon: Mountain, label: 'Silhouette' },
};

// eslint-disable-next-line complexity
const WaveformAnalysis = () => {
  const { track: playerTrack } = usePlayer();

  const [libraryTracks, setLibraryTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [mode, setMode] = useState('amplitude');
  const [showGhostGrid, setShowGhostGrid] = useState(false);
  const [showDetectedBeats, setShowDetectedBeats] = useState(false);
  const [showDownbeats, setShowDownbeats] = useState(false);
  const [showKeyBadge, setShowKeyBadge] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  // Whether the current track's fetched data actually has beats/a downbeat
  // guess to show — separate from the show* toggles above (those are what
  // the user *wants* shown; these are what's *available* to show), so the
  // toolbar buttons can disable themselves the same way the BPM/key ones do.
  const [beatDataAvailable, setBeatDataAvailable] = useState({
    beats: false,
    downbeat: false,
  });

  const waveformContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const displayRef = useRef(null);
  const wavesurferRef = useRef(null);
  const frequencyDataRef = useRef(null);
  const abortRef = useRef(null);
  // Refs for zoom/scroll so drawCanvas doesn't need them as deps
  // (prevents the audio-loading effect from re-running on every zoom change)
  const zoomRef = useRef(1);
  const scrollFractionRef = useRef(0);
  // Ref for mode so drawCanvas can dispatch without mode being a dep
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const loadTracks = async () => {
      try {
        const result = await getTracks({ limit: 5_000 });
        setLibraryTracks(result?.tracks ?? []);
      } catch {
        /* ignore */
      }
    };

    loadTracks();
  }, []);

  useEffect(() => {
    if (!playerTrack?.path || libraryTracks.length === 0) return;
    const match = libraryTracks.find((t) => t.path === playerTrack.path);
    if (match) setSelectedTrack(match);
  }, [libraryTracks, playerTrack]);

  const drawCanvas = useCallback(() => {
    const data = frequencyDataRef.current;
    const canvas = canvasRef.current;
    if (!data || !canvas) return;
    const z = zoomRef.current;
    const sf = scrollFractionRef.current;
    const m = modeRef.current;

    if (m === 'smooth') {
      drawSmooth(
        canvas,
        data.lowPeaks,
        data.midPeaks,
        data.highPeaks,
        data.overallPeaks,
        z,
        sf,
      );
    } else if (m === 'silhouette') {
      drawSilhouette(
        canvas,
        data.lowPeaks,
        data.midPeaks,
        data.highPeaks,
        data.overallPeaks,
        z,
        sf,
      );
    } else {
      drawBars(
        canvas,
        data.lowPeaks,
        data.midPeaks,
        data.highPeaks,
        data.overallPeaks,
        z,
        sf,
      );
    }

    if (
      (showGhostGrid || showDetectedBeats || showDownbeats) &&
      selectedTrack?.bpm &&
      data.duration
    ) {
      drawBeatOverlay(canvas, {
        beatOffsetSeconds: data.beatOffsetSeconds,
        beats: data.beats,
        beatsKnown: data.beatsKnown,
        bpm: selectedTrack.bpm,
        downbeatOffsetSeconds: data.downbeatOffsetSeconds,
        duration: data.duration,
        scrollFraction: sf,
        showDetectedBeats,
        showDownbeats,
        showGhostGrid,
        zoom: z,
      });
    }
  }, [showGhostGrid, showDetectedBeats, showDownbeats, selectedTrack?.bpm]);

  // Redraw when mode changes (without re-analysing audio)
  useEffect(() => {
    if (CANVAS_MODES.includes(mode)) drawCanvas();
  }, [drawCanvas, mode]);

  // Redraw on beat-overlay toggle / key badge changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Zoom WaveSurfer when zoom or audioDuration changes
  useEffect(() => {
    if (mode !== 'amplitude' || !wavesurferRef.current || !audioDuration)
      return;
    const container = waveformContainerRef.current;
    if (!container) return;
    wavesurferRef.current.zoom(
      (container.offsetWidth / audioDuration) * zoomRef.current,
    );
  }, [audioDuration, mode, zoom]);

  // Horizontal scroll on display area pans the frequency canvas
  useEffect(() => {
    const element = displayRef.current;
    if (!element) return undefined;
    const handler = (e) => {
      if (zoomRef.current <= 1 || !CANVAS_MODES.includes(modeRef.current))
        return;
      e.preventDefault();
      const maxFraction = 1 - 1 / zoomRef.current;
      scrollFractionRef.current = Math.max(
        0,
        Math.min(maxFraction, scrollFractionRef.current + e.deltaX / 3_000),
      );
      drawCanvas();
    };

    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, [drawCanvas]);

  // Audio loading — only re-runs when track or amplitude/canvas split changes.
  // Switching between canvas render modes reuses existing analysis data.
  const isCanvas = CANVAS_MODES.includes(mode);
  useEffect(() => {
    if (!selectedTrack) return undefined;

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    setLoadError(null);

    if (!isCanvas) {
      // Amplitude mode — WaveSurfer
      frequencyDataRef.current = null;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      setAudioDuration(0);

      if (!waveformContainerRef.current) return undefined;
      setLoading(true);

      const ws = WaveSurfer.create({
        barGap: 1,
        barWidth: 2,
        container: waveformContainerRef.current,
        height: 180,
        interact: false,
        normalize: true,
        progressColor: '#2a6ebf',
        waveColor: '#58a6ff',
      });
      wavesurferRef.current = ws;

      ws.on('ready', () => {
        if (abortController.signal.aborted) return;
        setLoading(false);
        setAudioDuration(ws.getDuration());
      });
      ws.on('error', () => {
        if (abortController.signal.aborted) return;
        setLoading(false);
        setLoadError('Failed to load audio');
      });

      ws.load(getLocalStreamUrl(selectedTrack.path)).catch(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
          setLoadError('Failed to load audio');
        }
      });
    } else {
      // Canvas mode — if we already have data for this track, just redraw
      if (frequencyDataRef.current?.trackPath === selectedTrack.path) {
        drawCanvas();
        return undefined;
      }

      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      frequencyDataRef.current = null;
      setAudioDuration(0);
      setBeatDataAvailable({ beats: false, downbeat: false });
      setLoading(true);

      const analyse = async () => {
        try {
          // Try pre-computed data from backend first
          let bands = null;
          // Set only when the backend already had a cached analysis — the authoritative PCM
          // duration the waveform bars were actually generated against, same field the main
          // player's WaveformSeekBar uses via resolveWaveformDuration. Previously this stayed
          // null on the cached-data path and silently fell through to `selectedTrack.duration`
          // (a separate, tag-derived estimate) even when the real analysis duration was right
          // there in the response — a second, un-unified duration source for this screen.
          let analysisDuration = null;
          // A one-time decodeAudioData duration, set only on the fallback path below when no
          // cached analysis exists at all — stable (a full synchronous decode, not subject to
          // the progressive-durationchange instability HTMLAudioElement.duration can have), but
          // still ranked below the real analysis duration.
          let decodedDuration = null;
          let beatOffsetSeconds = null;
          let beatsKnown = false;
          let beats = null;
          let downbeatOffsetSeconds = null;
          let downbeatConfidence = null;
          try {
            await analyseTrack(selectedTrack.path);
            if (abortController.signal.aborted) return;

            const res = await api.get('/analysis/waveform', {
              params: { cachedOnly: true, path: selectedTrack.path },
              signal: abortController.signal,
            });
            if (res.data && !abortController.signal.aborted) {
              bands = {
                overallPeaks: new Float32Array(res.data.overallPeaks),
                lowPeaks: new Float32Array(res.data.lowPeaks),
                midPeaks: new Float32Array(res.data.midPeaks),
                highPeaks: new Float32Array(res.data.highPeaks),
              };
              analysisDuration = res.data.analysisDuration ?? null;
              const beatAvailability = resolveBeatAvailability(res.data);
              beatOffsetSeconds = beatAvailability.offsetSeconds;
              beatsKnown = beatAvailability.known;
              // Detected beats and the downbeat heuristic are independent of
              // the waveform bands — kept as their own values rather than
              // folded into `bands` so a comparison against the ghost grid
              // never has to reach through the peaks data to find them.
              beats = res.data.beats?.length
                ? new Float32Array(res.data.beats)
                : null;
              downbeatOffsetSeconds = res.data.downbeatOffsetSeconds ?? null;
              downbeatConfidence = res.data.downbeatConfidence ?? null;
            }
          } catch {
            /* not cached — fall through to browser analysis */
          }

          if (abortController.signal.aborted) return;

          if (!bands) {
            // Fall back to browser-side analysis
            const response = await fetch(
              getLocalStreamUrl(selectedTrack.path),
              { signal: abortController.signal },
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            if (abortController.signal.aborted) return;

            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            await audioContext.close();
            if (abortController.signal.aborted) return;

            const canvas = canvasRef.current;
            if (canvas) {
              const containerWidth =
                canvas.parentElement?.offsetWidth || canvas.offsetWidth;
              if (containerWidth > 0) canvas.width = containerWidth;
            }

            const numberBars = (canvasRef.current?.width ?? 1_300) * 4;

            const rawMono = audioBuffer.getChannelData(0);
            const monoData =
              audioBuffer.numberOfChannels > 1
                ? (() => {
                    const right = audioBuffer.getChannelData(1);
                    const mixed = new Float32Array(rawMono.length);
                    for (let index = 0; index < rawMono.length; index++)
                      mixed[index] = (rawMono[index] + right[index]) / 2;
                    return mixed;
                  })()
                : rawMono;

            bands = computeFrequencyBands(
              monoData,
              audioBuffer.sampleRate,
              numberBars,
            );
            decodedDuration = audioBuffer.duration;
          }

          if (abortController.signal.aborted) return;

          frequencyDataRef.current = {
            trackPath: selectedTrack.path,
            duration: resolveWaveformDuration(
              analysisDuration,
              selectedTrack.duration,
              decodedDuration,
            ),
            beatOffsetSeconds,
            beats,
            beatsKnown,
            downbeatOffsetSeconds,
            downbeatConfidence,
            highPeaks: bands.highPeaks,
            lowPeaks: bands.lowPeaks,
            midPeaks: bands.midPeaks,
            overallPeaks: bands.overallPeaks,
          };

          setAudioDuration(frequencyDataRef.current.duration);
          setBeatDataAvailable({
            beats: Boolean(beats?.length),
            downbeat: downbeatOffsetSeconds != null,
          });
          setLoading(false);
          drawCanvas();
        } catch (error) {
          if (abortController.signal.aborted) return;
          setLoading(false);
          setLoadError(
            error instanceof Error ? error.message : 'Analysis failed',
          );
        }
      };

      analyse();
    }

    return () => {
      abortController.abort();
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawCanvas, isCanvas, selectedTrack]);

  const handleZoomIn = () => {
    const index = ZOOM_LEVELS.indexOf(zoom);
    if (index >= ZOOM_LEVELS.length - 1) return;
    const next = ZOOM_LEVELS[index + 1];
    zoomRef.current = next;
    scrollFractionRef.current = 0;
    setZoom(next);
    drawCanvas();
  };

  const handleZoomOut = () => {
    const index = ZOOM_LEVELS.indexOf(zoom);
    if (index <= 0) return;
    const next = ZOOM_LEVELS[index - 1];
    zoomRef.current = next;
    scrollFractionRef.current = 0;
    setZoom(next);
    drawCanvas();
  };

  const handleExport = () => {
    if (isCanvas) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `${selectedTrack?.title ?? 'waveform'}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } else if (wavesurferRef.current) {
      const canvas = waveformContainerRef.current?.querySelector('canvas');
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `${selectedTrack?.title ?? 'waveform'}.png`;
      link.href = canvas.toDataURL();
      link.click();
    }
  };

  const minutes = Math.floor(audioDuration / 60);
  const seconds = Math.floor(audioDuration % 60);
  const durationLabel =
    audioDuration > 0
      ? `${String(minutes)}:${String(seconds).padStart(2, '0')}`
      : '';
  const downbeatConfidencePct = frequencyDataRef.current?.downbeatConfidence;
  const downbeatConfidenceLabel =
    downbeatConfidencePct == null
      ? 'unknown'
      : `${Math.round(downbeatConfidencePct * 100)}%`;

  return (
    <div className="wa-root">
      <TrackPicker
        libraryTracks={libraryTracks}
        onSelect={setSelectedTrack}
        selectedTrack={selectedTrack}
      />

      {selectedTrack && (
        <>
          <div className="wa-toolbar">
            <div className="wa-mode-group">
              {Object.entries(MODE_META).map(([key, { icon: Icon, label }]) => (
                <button
                  className={`wa-mode-btn hover-fx${mode === key ? ' wa-mode-btn--active' : ''}`}
                  key={key}
                  onClick={() => setMode(key)}
                  type="button"
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>

            <div className="wa-overlay-group">
              <button
                className={`wa-overlay-btn hover-fx${showGhostGrid ? ' wa-overlay-btn--active' : ''}`}
                disabled={!selectedTrack?.bpm || !beatDataAvailable.beats}
                onClick={() => setShowGhostGrid((c) => !c)}
                title={
                  !selectedTrack?.bpm
                    ? 'No BPM data'
                    : beatDataAvailable.beats
                      ? 'Ghost grid — the theoretical beat clock (bpm + phase), not what was detected'
                      : 'No detected-beat data to anchor the grid to — a BPM tag alone is not beat analysis'
                }
                type="button"
              >
                <Grid3x3 size={12} />
                Ghost grid
              </button>
              <button
                className={`wa-overlay-btn hover-fx${showDetectedBeats ? ' wa-overlay-btn--active' : ''}`}
                disabled={!beatDataAvailable.beats}
                onClick={() => setShowDetectedBeats((c) => !c)}
                title={
                  beatDataAvailable.beats
                    ? "Detected beats — Essentia's actual ticks, compare against the ghost grid"
                    : 'No detected-beat data — run a BPM scan for this track'
                }
                type="button"
              >
                <AudioWaveform size={12} />
                Detected beats
              </button>
              <button
                className={`wa-overlay-btn hover-fx${showDownbeats ? ' wa-overlay-btn--active' : ''}`}
                disabled={!beatDataAvailable.downbeat}
                onClick={() => setShowDownbeats((c) => !c)}
                title={
                  beatDataAvailable.downbeat
                    ? `Downbeats — heuristic bar-1 guess (confidence ${downbeatConfidenceLabel}), not a dedicated detector`
                    : 'No downbeat data — needs at least 8 detected beats'
                }
                type="button"
              >
                <BarChart2 size={12} />
                Downbeats
              </button>
              <button
                className={`wa-overlay-btn hover-fx${showKeyBadge ? ' wa-overlay-btn--active' : ''}`}
                disabled={!selectedTrack?.key}
                onClick={() => setShowKeyBadge((c) => !c)}
                title={selectedTrack?.key ? 'Key badge' : 'No key data'}
                type="button"
              >
                <Tag size={12} />
                Key
              </button>
            </div>

            <div className="wa-zoom-group">
              <button
                className="wa-zoom-btn hover-fx"
                disabled={zoom === ZOOM_LEVELS[0]}
                onClick={handleZoomOut}
                title="Zoom out"
                type="button"
              >
                <ZoomOut size={13} />
              </button>
              <span className="wa-zoom-label">{zoom}×</span>
              <button
                className="wa-zoom-btn hover-fx"
                disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                onClick={handleZoomIn}
                title="Zoom in"
                type="button"
              >
                <ZoomIn size={13} />
              </button>
            </div>

            <button
              className="wa-export-btn hover-fx"
              disabled={!audioDuration}
              onClick={handleExport}
              title="Export PNG"
              type="button"
            >
              <Download size={13} />
            </button>
          </div>

          <div
            className="wa-display"
            ref={displayRef}
          >
            {loading && (
              <div className="wa-loading">
                <span className="wa-spinner" />
                Decoding audio…
              </div>
            )}
            {loadError && !loading && (
              <div className="wa-error">{loadError}</div>
            )}

            <div
              className="wa-waveform-container"
              ref={waveformContainerRef}
              style={{ display: mode === 'amplitude' ? 'block' : 'none' }}
            />
            <canvas
              className="wa-freq-canvas"
              height={180}
              ref={canvasRef}
              style={{ display: isCanvas ? 'block' : 'none' }}
              width={1_200}
            />

            {showKeyBadge && selectedTrack.key && (
              <div className="wa-key-badge">{selectedTrack.key}</div>
            )}
            {durationLabel && (
              <div className="wa-duration-badge">{durationLabel}</div>
            )}
          </div>
        </>
      )}

      {!selectedTrack && (
        <div className="wa-empty">
          <AudioWaveform
            size={40}
            strokeWidth={1}
          />
          <p>Select a track to view its waveform</p>
        </div>
      )}
    </div>
  );
};

export default WaveformAnalysis;
