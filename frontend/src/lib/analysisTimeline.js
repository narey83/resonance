// <copyright file="analysisTimeline.js" company="John Narey">
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

// The single authoritative timeline for waveform/beat/playhead positioning.
//
// The backend decodes each file once, to a known PCM timeline (AudioAnalyzer.SampleRate),
// and generates the waveform bars and beat timestamps against exactly that timeline. That
// duration — analysisDuration — is the one this whole module exists to keep authoritative.
// It must never be silently swapped out for HTMLAudioElement.duration, which a browser can
// revise mid-playback for a streamed, variable-bitrate file while currentTime stays accurate
// (see resolveWaveformDuration, and commit 7a380db which fixed the resulting drift).
//
// Every waveform-related time<->pixel conversion, and the (today identity, but explicit)
// relationship between the browser's playback clock and the analysis timeline, should go
// through the functions here rather than being recomputed inline per component.

/**
 * Picks the duration the waveform/playhead/beat-grid should be laid out against.
 * @param {number|null|undefined} analysisDuration the `/analysis/waveform` response's
 *   `analysisDuration` (PCM length / analysis sample rate) — the timebase the bars were actually
 *   generated against. Authoritative whenever present.
 * @param {number|null|undefined} trackLength a stable, non-live duration already known for the
 *   track (e.g. the library's own tag-derived length) — used when no analysis duration exists yet
 *   (a track whose waveform predates this field, or hasn't been analysed at all).
 * @param {number} audioDuration `HTMLAudioElement.duration` — a last resort only, since it's the
 *   one value in this list that can change mid-playback. Once `analysisDuration` is available it
 *   is authoritative: this function must never let `audioDuration` override it.
 * @returns {number} the duration to use for waveform/playhead/grid positioning, never negative.
 */
export const resolveWaveformDuration = (
  analysisDuration,
  trackLength,
  audioDuration,
) => {
  if (Number.isFinite(analysisDuration) && analysisDuration > 0) {
    return analysisDuration;
  }

  if (Number.isFinite(trackLength) && trackLength > 0) {
    return trackLength;
  }

  return Number.isFinite(audioDuration) && audioDuration > 0
    ? audioDuration
    : 0;
};

/**
 * Converts a moment on the analysis timeline to a pixel offset. The one place this
 * calculation happens — waveform bars, the playhead, the beat grid, and every seek/scratch
 * target all convert through this function (and its inverse, `pixelToTime`) rather than each
 * recomputing `time / duration * width` independently.
 *
 * Works equally for the whole track (`duration` = the full `analysisDuration`, `width` = the
 * full canvas) or for a zoomed sub-window (`time` relative to the window's start, `duration` =
 * the window's length, `width` = the window's drawn pixel width) — zoom is a choice of which
 * (duration, width) pair to convert against, not a second formula.
 * @param {number} time seconds, relative to whatever `duration` spans.
 * @param {number} duration the span `time` is relative to, in seconds.
 * @param {number} width the pixel width that span is drawn across.
 * @returns {number} the pixel offset; 0 if `duration` is not positive.
 */
export const timeToPixel = (time, duration, width) =>
  duration > 0 ? (time / duration) * width : 0;

/**
 * The inverse of `timeToPixel`: converts a pixel offset back to a moment on whatever
 * (duration, width) span it was measured against.
 * @param {number} pixel the pixel offset.
 * @param {number} duration the span `pixel` is relative to, in seconds.
 * @param {number} width the pixel width that span is drawn across.
 * @returns {number} the time in seconds; 0 if `width` is not positive.
 */
export const pixelToTime = (pixel, duration, width) =>
  width > 0 ? (pixel / width) * duration : 0;

/**
 * Converts a moment on the browser's playback clock (`HTMLAudioElement.currentTime`) to the
 * corresponding moment on the analysis timeline.
 *
 * Today this is the identity function: a direct empirical check (an independent
 * `decodeAudioData` decode of a real VBR MP3 with a measured ~23ms LAME encoder delay,
 * compared against the backend's ffmpeg-based analysis decode) showed the two timelines agree
 * to within about 0.02ms — no measurable offset or scale factor. It is kept as a named,
 * separately-callable function rather than assumed inline so that if a genuine codec/browser
 * combination is ever found to need a real correction, there is exactly one place to encode
 * it — see `analysisToPlaybackTime` for the inverse direction. Do not add an offset or scale
 * factor here without new empirical evidence of one being required.
 * @param {number} playbackTime `audio.currentTime`, in seconds.
 * @returns {number} the corresponding analysis-timeline time, in seconds.
 */
export const playbackToAnalysisTime = (playbackTime) => playbackTime;

/**
 * The inverse of `playbackToAnalysisTime`: converts an analysis-timeline time (e.g. the result
 * of a waveform seek) to the value that should actually be assigned to `audio.currentTime`.
 * Identity today, for the same reason `playbackToAnalysisTime` is — see its documentation.
 * @param {number} analysisTime seconds, on the analysis timeline.
 * @returns {number} the corresponding playback-clock time, in seconds.
 */
export const analysisToPlaybackTime = (analysisTime) => analysisTime;

/**
 * Whether a track's real beat analysis is available, and if so, on the same terms the
 * waveform bars themselves use.
 *
 * `beatOffsetSeconds`/`beats` are both null together whenever Essentia never ran or detected
 * no ticks for a track — including a track that has a BPM *tag* (`track.bpm`, read from the
 * file's own metadata, not from this analysis). A tag alone is not beat analysis: rendering a
 * theoretical grid anchored at phase 0 for a track with no real beat detection has previously
 * shipped as a bug (fabricating `beatOffsetSeconds ?? 0`), producing a confident-looking grid
 * with no basis. Callers must check `known` before drawing anything beat-grid-shaped, rather
 * than defaulting `offsetSeconds`.
 * @param {{beatOffsetSeconds?: number|null, beats?: number[]|Float32Array|null}|null|undefined} data
 *   the relevant slice of a `/analysis/waveform` response.
 * @returns {{known: boolean, offsetSeconds: number|null, beats: (number[]|Float32Array|null)}}
 *   `known` is true only when a real detected beat offset exists.
 */
export const resolveBeatAvailability = (data) => {
  const known = Boolean(data) && data.beatOffsetSeconds != null;
  return {
    beats: known ? data.beats ?? null : null,
    known,
    offsetSeconds: known ? data.beatOffsetSeconds : null,
  };
};
