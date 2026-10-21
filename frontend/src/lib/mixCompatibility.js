import { resolveWaveformDuration, timeToPixel } from './analysisTimeline';
import { toCamelot } from './camelot';
import { djTimeline } from './enhancedWaveform';
import { compareGenres } from './genreCompatibility';
import { djSummary } from './libraryWorkbench';
import { masterTempoPlan } from './playerTempo';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
export const mixPath = (track) =>
  track?.localRelativePath || track?.path || track?.filename || null;
export const mixPlayerTrack = (track) => ({
  ...track,
  filename: mixPath(track),
  path: mixPath(track),
  localRelativePath: mixPath(track),
  length: track.duration ?? track.length,
});

export const mixDuration = (data) =>
  resolveWaveformDuration(
    data?.waveform?.analysisDuration,
    [
      data?.enhanced?.durationSeconds,
      data?.track?.duration,
      data?.track?.length,
    ].find((value) => finite(value) && value > 0),
    0,
  );

export const mixKey = (value) => {
  if (typeof value !== 'string') return null;
  const key = value.trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  const code = key.toUpperCase();
  if (/^(?:[1-9]|1[0-2])[AB]$/.test(code)) return code;
  return toCamelot(key) || null;
};

export const compareKeys = (a, b) => {
  const from = mixKey(a);
  const to = mixKey(b);
  if (!from || !to) return { known: false, label: 'Key unavailable', from, to };
  const step = Math.abs(Number.parseInt(from, 10) - Number.parseInt(to, 10));
  if (from === to)
    return { known: true, kind: 'same', label: 'Same key', from, to };
  if (step === 0)
    return {
      known: true,
      kind: 'relative',
      label: 'Relative major / minor',
      from,
      to,
    };
  if (from.slice(-1) === to.slice(-1) && (step === 1 || step === 11))
    return {
      known: true,
      kind: 'neighbour',
      label: 'Neighbouring key',
      from,
      to,
    };
  return { known: true, kind: 'contrast', label: 'Key contrast', from, to };
};

export const compareTempo = (a, b) => {
  if (![a, b].every((value) => finite(value) && value >= 20 && value <= 400))
    return { known: false, label: 'Tempo unavailable' };
  const adjustment = (a / b - 1) * 100;
  const alternatives = [0.5, 2].map((factor) => ({
    bpm: b * factor,
    factor,
    adjustment: (a / (b * factor) - 1) * 100,
  }));
  const alternative = alternatives.find(
    (item) => Math.abs(item.adjustment) <= 6 && Math.abs(adjustment) > 10,
  );
  return {
    known: true,
    from: a,
    to: b,
    adjustment,
    alternative,
    label:
      Math.abs(adjustment) <= 6
        ? 'Close tempo'
        : Math.abs(adjustment) <= 10
          ? 'Larger tempo move'
          : 'Big tempo move',
  };
};

// Union first: singing and processed-voice predictions can describe the same
// source moment. Counting both would overstate overlap and change window choices.
export const mergeRegions = (segments, duration) => {
  const rows = (Array.isArray(segments) ? segments : [])
    .flatMap((segment) => {
      const lo = segment.startSeconds ?? segment.start_seconds;
      const hi = segment.endSeconds ?? segment.end_seconds;
      if (!finite(lo) || !finite(hi) || hi <= lo || hi <= 0 || lo >= duration)
        return [];
      return [{ start: clamp(lo, 0, duration), end: clamp(hi, 0, duration) }];
    })
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const row of rows) {
    const previous = merged[merged.length - 1];
    if (previous && row.start <= previous.end)
      previous.end = Math.max(previous.end, row.end);
    else merged.push({ ...row });
  }

  return merged;
};

export const windowRegions = (data, window) => {
  if (!data?.enhanced?.available || !window || window.end <= window.start)
    return [];
  return mergeRegions(
    [
      ...(Array.isArray(data.enhanced.singing) ? data.enhanced.singing : []),
      ...(Array.isArray(data.enhanced.processedVoice)
        ? data.enhanced.processedVoice
        : []),
    ],
    mixDuration(data),
  ).flatMap((region) => {
    const lo = Math.max(region.start, window.start);
    const hi = Math.min(region.end, window.end);
    return hi > lo
      ? [
          {
            start: timeToPixel(lo - window.start, window.end - window.start, 1),
            end: timeToPixel(hi - window.start, window.end - window.start, 1),
          },
        ]
      : [];
  });
};

const voiceKnown = (data) =>
  Boolean(
    data?.enhanced?.available &&
      Array.isArray(data.enhanced.singing) &&
      Array.isArray(data.enhanced.processedVoice),
  );
const points = (values, duration) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : []).filter(
        (t) => finite(t) && t >= 0 && t <= duration,
      ),
    ),
  ].sort((a, b) => a - b);
export const mixSections = (data) => {
  const duration = mixDuration(data);
  return djTimeline(data?.enhanced).sections.flatMap((section) => {
    const lo = section.start_seconds ?? section.startSeconds;
    const hi = section.end_seconds ?? section.endSeconds;
    if (!finite(lo) || !finite(hi) || hi <= lo || hi <= 0 || lo >= duration)
      return [];
    return [
      {
        start: clamp(lo, 0, duration),
        end: clamp(hi, 0, duration),
        label: section.label || 'Section',
      },
    ];
  });
};

const coverage = (regions) =>
  regions.reduce((sum, region) => sum + region.end - region.start, 0);
export const overlapFraction = (a, b) => {
  let total = 0;
  for (const left of a)
    for (const right of b)
      total += Math.max(
        0,
        Math.min(left.end, right.end) - Math.max(left.start, right.start),
      );
  return clamp(total, 0, 1);
};

export const mixWindows = (data, direction, requestedBars = 16) => {
  const duration = mixDuration(data);
  if (!duration) return [];
  const bars = [8, 16, 32].includes(requestedBars) ? requestedBars : 16;
  const sections = mixSections(data);
  const downbeats = data?.enhanced?.available
    ? points(data.enhanced.downbeats, duration)
    : [];
  const boundary = (start) =>
    sections.find(
      (section) => start >= section.start - 0.1 && start < section.end,
    );
  const candidates = [];
  for (let i = 0; i + bars < downbeats.length; i++) {
    const start = downbeats[i];
    const end = downbeats[i + bars];
    if (direction === 'entry' ? start > duration * 0.4 : end < duration * 0.6)
      continue;
    if (end - start < 2) continue;
    candidates.push({
      start,
      end,
      bars,
      aligned: true,
      label: boundary(start)?.label || 'Detected bars',
    });
  }

  if (!candidates.length) {
    const bpm = data?.track?.bpm;
    const length = finite(bpm) && bpm > 0 ? (bars * 4 * 60) / bpm : 30;
    const start = clamp(
      direction === 'entry' ? 0 : duration - length,
      0,
      Math.max(0, duration - Math.min(length, duration)),
    );
    candidates.push({
      start,
      end: Math.min(duration, start + length),
      bars: null,
      aligned: false,
      label: boundary(start)?.label || 'Time-based suggestion',
    });
  }

  // A transition rehearses the ending into the opening. Predicted vocal
  // clashes are warnings, not a reason to jump into the middle of either song.
  const window =
    direction === 'entry' ? candidates[0] : candidates[candidates.length - 1];
  return [{ ...window, score: coverage(windowRegions(data, window)) }];
};

const timing = (data, window) => {
  const ticks = points(data?.enhanced?.beats, mixDuration(data)).filter(
    (t) => t >= window.start && t <= window.end,
  );
  const intervals = ticks
    .slice(1)
    .map((t, i) => t - ticks[i])
    .filter((gap) => gap > 0.1 && gap < 3)
    .sort((a, b) => a - b);
  if (intervals.length < 8) return { known: false };
  const spread =
    intervals[Math.floor(intervals.length * 0.9)] /
    intervals[Math.floor(intervals.length * 0.1)];
  const localBpm =
    (60 * (ticks.length - 1)) / (ticks[ticks.length - 1] - ticks[0]);
  const tag = data?.track?.bpm;
  return {
    known: true,
    variable: spread > 1.12,
    localBpm,
    differs: finite(tag) && Math.abs(localBpm / tag - 1) > 0.04,
  };
};

export const mixCompatibility = (
  outgoing,
  incoming,
  requestedBars = 16,
  masterBpm = null,
  extended = false,
) => {
  const master = masterTempoPlan(
    outgoing?.track?.bpm,
    incoming?.track?.bpm,
    masterBpm ?? outgoing?.track?.bpm,
    extended,
  );
  const tempo = compareTempo(master.target, incoming?.track?.bpm);
  tempo.known = tempo.known && master.a.known;
  const genre = compareGenres(outgoing?.track, incoming?.track);
  const key = compareKeys(outgoing?.track?.key, incoming?.track?.key);
  const aLufs = outgoing?.track?.lufs;
  const bLufs = incoming?.track?.lufs;
  const loudness =
    finite(aLufs) && finite(bLufs)
      ? { known: true, delta: bLufs - aLufs }
      : { known: false };
  const known = voiceKnown(outgoing) && voiceKnown(incoming);
  const sameTrack =
    mixPath(outgoing?.track) &&
    mixPath(outgoing?.track) === mixPath(incoming?.track);
  let plan = null;
  const entries = sameTrack ? [] : mixWindows(incoming, 'entry', requestedBars);
  for (const exit of sameTrack
    ? []
    : mixWindows(outgoing, 'exit', requestedBars)) {
    for (const entry of entries) {
      const aVoice = windowRegions(outgoing, exit);
      const bVoice = windowRegions(incoming, entry);
      const fraction = known ? overlapFraction(aVoice, bVoice) : null;
      const score = exit.score + entry.score + (fraction || 0) * 4;
      if (!plan || score < plan.score)
        plan = { exit, entry, score, fraction, aVoice, bVoice };
    }
  }

  if (plan) {
    plan.duration = (plan.exit.end - plan.exit.start) / (master.a.rate || 1);
    plan.overlapSeconds = known ? plan.fraction * plan.duration : null;
    plan.timingA = timing(outgoing, plan.exit);
    plan.timingB = timing(incoming, plan.entry);
    plan.phaseUncertain = [outgoing, incoming].some(
      (data) =>
        finite(data?.enhanced?.downbeatConfidence) &&
        data.enhanced.downbeatConfidence < 0.15,
    );
  }

  let label = 'Partial picture';
  if (tempo.known && key.known) {
    label =
      Math.abs(tempo.adjustment) > 10 || key.kind === 'contrast'
        ? 'Plan a deliberate transition'
        : known && plan?.exit.aligned && plan?.entry.aligned
          ? 'Promising blend'
          : 'Tempo / key starting point';
    if (plan && known && plan.overlapSeconds > 2)
      label = 'Watch the vocal overlap';
    if (
      plan &&
      [plan.timingA, plan.timingB].some((t) => t.variable || t.differs)
    )
      label = 'Check the timing';
  }

  if (sameTrack) label = 'Choose two different tracks';
  else if (!['Check the timing', 'Watch the vocal overlap'].includes(label)) {
    if (genre.kind === 'cross') label = 'Plan a cross-genre transition';
    else if (genre.kind === 'conflict') label = 'Check the genre evidence';
    else if (!genre.known && label === 'Promising blend')
      label = 'Tempo / key starting point';
  }

  const signals = [
    tempo.known,
    key.known,
    loudness.known,
    known,
    Boolean(plan?.exit.aligned && plan?.entry.aligned),
    genre.known,
  ].filter(Boolean).length;
  return {
    tempo,
    master,
    genre,
    key,
    loudness,
    plan,
    voiceKnown: known,
    signals,
    label,
    sameTrack: Boolean(sameTrack),
    energyA: djSummary(outgoing?.track).energy,
    energyB: djSummary(incoming?.track).energy,
    genreA: outgoing?.track?.genre || djSummary(outgoing?.track).genre,
    genreB: incoming?.track?.genre || djSummary(incoming?.track).genre,
  };
};

// Audition keeps queued tracks in order. A new audition target is appended once;
// existing targets get fresh metadata without replacing the rest of the queue.
export const auditionQueue = (queue, track) => {
  const target = mixPlayerTrack(track);
  const index = (queue || []).findIndex(
    (row) => mixPath(row) === mixPath(track),
  );
  if (index < 0)
    return { tracks: [...(queue || []), target], index: (queue || []).length };
  return {
    tracks: queue.map((row, i) => (i === index ? { ...row, ...target } : row)),
    index,
  };
};
