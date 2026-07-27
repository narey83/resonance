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
import api from '../../lib/api';
import { getLocalStreamUrl } from '../../lib/files';
import { fuzzyFilter } from '../../lib/fuzzy';
import { getTracks } from '../../lib/musicLibrary';
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

const drawBpmGrid = (canvas, bpm, duration, zoom = 1, scrollFraction = 0) => {
  if (!bpm || !duration) return;
  const context = canvas.getContext('2d');
  const visibleDuration = duration / zoom;
  const startTime = scrollFraction * (duration - visibleDuration);
  const pixelsPerSecond = canvas.width / visibleDuration;
  const secondsPerBeat = 60 / bpm;

  context.save();
  context.strokeStyle = 'rgba(255,255,255,0.22)';
  context.lineWidth = 1;
  for (let time = 0; time < duration; time += secondsPerBeat) {
    if (time < startTime || time > startTime + visibleDuration) continue;
    const x = Math.round((time - startTime) * pixelsPerSecond) + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }

  context.restore();
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
  const [showBpmGrid, setShowBpmGrid] = useState(false);
  const [showKeyBadge, setShowKeyBadge] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [zoom, setZoom] = useState(1);

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

    if (showBpmGrid && selectedTrack?.bpm && data.duration) {
      drawBpmGrid(canvas, selectedTrack.bpm, data.duration, z, sf);
    }
  }, [showBpmGrid, selectedTrack?.bpm]);

  // Redraw when mode changes (without re-analysing audio)
  useEffect(() => {
    if (CANVAS_MODES.includes(mode)) drawCanvas();
  }, [drawCanvas, mode]);

  // Redraw on showBpmGrid / key badge changes
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
      setLoading(true);

      const analyse = async () => {
        try {
          // Try pre-computed data from backend first
          let bands = null;
          let duration = null;
          try {
            const res = await api.get('/analysis/waveform', {
              params: { path: selectedTrack.path },
              signal: abortController.signal,
            });
            if (res.data && !abortController.signal.aborted) {
              bands = {
                overallPeaks: new Float32Array(res.data.overallPeaks),
                lowPeaks: new Float32Array(res.data.lowPeaks),
                midPeaks: new Float32Array(res.data.midPeaks),
                highPeaks: new Float32Array(res.data.highPeaks),
              };
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
            duration = audioBuffer.duration;
          }

          if (abortController.signal.aborted) return;

          frequencyDataRef.current = {
            trackPath: selectedTrack.path,
            duration: duration ?? selectedTrack.duration ?? 0,
            highPeaks: bands.highPeaks,
            lowPeaks: bands.lowPeaks,
            midPeaks: bands.midPeaks,
            overallPeaks: bands.overallPeaks,
          };

          setAudioDuration(frequencyDataRef.current.duration);
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
                className={`wa-overlay-btn hover-fx${showBpmGrid ? ' wa-overlay-btn--active' : ''}`}
                disabled={!selectedTrack?.bpm}
                onClick={() => setShowBpmGrid((c) => !c)}
                title={selectedTrack?.bpm ? 'BPM grid' : 'No BPM data'}
                type="button"
              >
                <Grid3x3 size={12} />
                BPM grid
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
