// <copyright file="candidateAnalysis.js" company="John Narey">
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

const summaries = {
  loops: (r) =>
    `${r.proposals?.length ?? 0} experimental beat-aligned loop proposals; audition required`,
  vocalPresence: (r) =>
    `${r.segments?.length ?? 0} possible-vocal spans; ${r.engine === 'CPJKU-zero-mean-singing-voice' ? 'experimental singing model; speech may be missed' : 'uncalibrated energy thresholds'}`,
  beats: (r) =>
    `${Number.isFinite(r.bpm_multi_interval) ? r.bpm_multi_interval.toFixed(2) : r.bpm_median_interval ?? 'Unknown'} BPM${r.tempo_variation_ratio > 1.1 ? ' (variable inferred tempo)' : ''} · ${r.beats_seconds?.length ?? 0} beats · ${r.downbeats_seconds?.length ?? 0} downbeats`,
  embedding: (r) =>
    `${r.embedding?.length ?? 0}D independent embedding · ${r.windows?.length ?? 0} windows`,
  key: (r) => r.key || 'No key returned',
  waveform: (r) =>
    `${r.bars ?? 0} display bars · ${r.sampleRate ?? 'Unknown'} Hz`,
  energy: (r) =>
    `${r.rms?.length ?? 0} RMS signal-energy windows; not the imported energy score`,
  loudness: (r) =>
    `${r.integratedLufs ?? 'Unknown'} LUFS · ${r.truePeakDbfs ?? 'Unknown'} dBFS true peak`,
  genre: (r) => {
    const labels = [...(r.scores || [])]
      .filter((score) => Number.isFinite(score.cosine))
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, 3)
      .map((score) => score.label || score.prompt)
      .filter(Boolean);
    return `${labels.length ? labels.join(' · ') : `${r.scores?.length ?? 0} prompt similarities`}; not genre-class probabilities`;
  },
  semanticPhrases: (r) =>
    `${r.segments?.length ?? 0} experimental semantic segments; model input distribution differs`,
  structure: (r) => `${r.sections?.length ?? 0} experimental sections`,
  phrases: (r) => `${r.sections?.length ?? 0} generic candidate sections`,
  cues: (r) =>
    `${r.cueProposals?.length ?? 0} experimental proposals; no hot cues written`,
  stems: (r) =>
    Object.keys(r.stems || {}).join(', ') || 'No separated files returned',
  vocalActivity: (r) =>
    `${r.bins?.length ?? 0} vocal RMS windows; not vocal probabilities`,
};

export const candidateFeatureRows = (analysis) =>
  Object.entries(analysis?.featureAvailability || {}).map(([name, status]) => {
    const feature = analysis.features?.[name] || {};
    const result = feature.result || {};
    return {
      name,
      status,
      engine: result.engine || result.identity?.engine || 'Independent engine',
      description:
        status === 'available'
          ? summaries[name]?.(result) || 'Result retained'
          : feature.reason || 'Unavailable',
    };
  });

export const candidateBeatWindow = (
  response,
  startSeconds = 0,
  windowSeconds = 30,
) => {
  const analysis = response?.analysis;
  if (
    !response?.contentCurrent ||
    analysis?.featureAvailability?.beats !== 'available'
  )
    return null;
  const result = analysis.features?.beats?.result;
  if (
    !Array.isArray(result?.beats_seconds) ||
    result.beats_seconds.length === 0
  )
    return null;
  const duration = result.duration_seconds ?? analysis.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const extent = Math.max(
    duration,
    result.beats_seconds[result.beats_seconds.length - 1],
  );
  const start = Math.max(0, Math.min(Number(startSeconds) || 0, extent));
  const end = Math.min(
    extent,
    start + Math.max(1, Number(windowSeconds) || 30),
  );
  if (end <= start) return null;
  const downbeats = new Set(result.downbeats_seconds || []);
  return {
    start,
    end,
    extent,
    beats: result.beats_seconds
      .filter((time) => Number.isFinite(time) && time >= start && time <= end)
      .map((time) => ({
        time,
        x: ((time - start) / (end - start)) * 1_000,
        downbeat: downbeats.has(time),
      })),
  };
};
