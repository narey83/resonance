// <copyright file="importedAnalysis.js" company="John Narey">
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

// Imported grids retain the source application's explicit timestamps.
export const importedGridWindow = (snapshot, startSeconds, windowSeconds) => {
  if (!snapshot?.contentCurrent || !snapshot.analysis) return null;
  const analysis = snapshot.analysis;
  if (!Array.isArray(analysis.beats) || analysis.beats.length === 0)
    return null;
  const duration = analysis.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const finalBeat = analysis.beats[analysis.beats.length - 1].timeSeconds;
  const gridExtent = Math.max(
    duration,
    Number.isFinite(finalBeat) ? finalBeat : duration,
  );
  const start = Math.max(0, Math.min(Number(startSeconds) || 0, gridExtent));
  const end = Math.min(
    gridExtent,
    start + Math.max(1, Number(windowSeconds) || 30),
  );
  const span = end - start;
  if (span <= 0) return null;
  const downbeats = new Set(analysis.downbeatsSeconds || []);
  return {
    duration,
    audioDuration: duration,
    gridExtent,
    end,
    start,
    beats: (analysis.beats || [])
      .filter(
        (beat) =>
          Number.isFinite(beat.timeSeconds) &&
          beat.timeSeconds >= start &&
          beat.timeSeconds <= end,
      )
      .map((beat) => ({
        ...beat,
        downbeat: downbeats.has(beat.timeSeconds),
        x: ((beat.timeSeconds - start) / span) * 1_000,
      })),
  };
};

export const importedFeatureSummary = (analysis) => {
  if (!analysis) return [];
  const waves = Object.entries(analysis.waveforms || {}).map(
    ([name, wave]) =>
      `${name}: ${wave.points?.length ?? 0} display points${wave.pointsPerSecond ? ` at ${wave.pointsPerSecond}/s` : ' across track'}`,
  );
  return [
    [
      'Energy model value',
      Number.isFinite(analysis.energyModelValue)
        ? String(analysis.energyModelValue)
        : 'Unavailable',
    ],
    ['Genre family', analysis.genreFamilyLabel || 'Unavailable'],
    [
      'Genre model class',
      Number.isInteger(analysis.genreClassId)
        ? String(analysis.genreClassId)
        : 'Unavailable',
    ],
    ['Genre class label', analysis.genreLabel || 'Unmapped'],
    [
      'Vocal activity',
      analysis.vocals?.levels
        ? `${analysis.vocals.levels.length} source bins (0–4)`
        : 'Unavailable',
    ],
    [
      'Phrases',
      analysis.phrases?.entries
        ? `${analysis.phrases.entries.length} candidate sections`
        : 'Unavailable',
    ],
    [
      'Cue and loop marks',
      analysis.positionMarks
        ? String(analysis.positionMarks.length)
        : 'Unavailable',
    ],
    ['Waveform formats', waves.join('; ') || 'Unavailable'],
    [
      'Embedding dimensions',
      analysis.embedding
        ? `${analysis.embedding.track?.length ?? 0}D track; ${analysis.embedding.projection2d?.length ?? 0}D projection; ${analysis.embedding.chunks?.length ?? 0} chunks`
        : 'Unavailable',
    ],
  ];
};

export const importedVocalWindow = (snapshot, startSeconds, windowSeconds) => {
  const analysis = snapshot?.analysis;
  if (!snapshot?.contentCurrent || !analysis?.vocals) return [];
  const step = analysis.vocals.frameStepSeconds;
  const levels = analysis.vocals.levels;
  if (!Number.isFinite(step) || step <= 0 || !Array.isArray(levels)) return [];
  const start = Math.max(0, Number(startSeconds) || 0);
  const span = Math.max(1, Number(windowSeconds) || 30);
  const from = Math.max(0, Math.ceil(start / step));
  const to = Math.min(levels.length, Math.ceil((start + span) / step));
  return levels.slice(from, to).map((level, offset) => ({
    level,
    seconds: (from + offset) * step,
    x: (((from + offset) * step - start) / span) * 1_000,
    width: (step / span) * 1_000,
  }));
};
