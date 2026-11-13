import api from './api';
import { harmonicNeighbours } from './camelot';

export const djSummary = (track) => {
  try {
    return typeof track?.djSummary === 'string'
      ? JSON.parse(track.djSummary)
      : track?.djSummary || {};
  } catch {
    return {};
  }
};

export const analysisStatus = (track, active = false, reviewed = false) => {
  if (active === 'queued')
    return {
      label: 'Queued',
      kind: 'working',
      detail: 'Submitted to the current analysis scan',
    };
  if (active)
    return {
      label: 'Analysing',
      kind: 'working',
      detail: 'Analysis is running for this track',
    };
  if (djSummary(track).complete && djSummary(track).automaticArrangement)
    return {
      label: reviewed ? 'Reviewed' : 'Enhanced Analysis',
      kind: 'ready',
      detail:
        'Automatic analysis complete. Uncertain DJ sections use neutral labels.',
    };
  if (djSummary(track).complete)
    return {
      label: reviewed ? 'Reviewed' : 'Review suggested',
      kind: reviewed ? 'ready' : 'review',
      detail: reviewed
        ? 'Marked reviewed by you'
        : 'Enhanced analysis available. Independent predictions; audition beatgrid and phrase labels.',
    };
  if (track.hasWaveform && track.bpm && track.key)
    return {
      label: 'Basic Analysis',
      kind: 'partial',
      detail: 'Waveform, tempo and key available; enhanced analysis is pending',
    };
  return {
    label: 'Pending',
    kind: 'pending',
    detail: 'Missing analysis; select Analyse to prepare this track',
  };
};

export const djQuery = (filters) => ({
  bpmMin: filters.bpmMin === '' ? undefined : Number(filters.bpmMin),
  bpmMax: filters.bpmMax === '' ? undefined : Number(filters.bpmMax),
  keys: filters.key
    ? [...harmonicNeighbours(filters.key)].join(',')
    : undefined,
  genre: filters.genre || undefined,
  energy: filters.energy || undefined,
  vocals: filters.vocals || undefined,
  analysis: filters.analysis || undefined,
});
export const resolveLibraryTracks = async (paths) => {
  const records = [];
  for (let i = 0; i < paths.length; i += 200)
    records.push(
      ...(await api.post('/musiclibrary/resolve', paths.slice(i, i + 200)))
        .data,
    );
  return records;
};

export const transitionHint = (previous, next) => {
  if (!previous || !next) return null;
  const delta =
    previous.bpm && next.bpm
      ? Math.round((next.bpm - previous.bpm) * 10) / 10
      : null;
  const compatible =
    previous.key && next.key
      ? harmonicNeighbours(previous.key).has(next.key)
      : null;
  return {
    delta,
    compatible,
    label: [
      delta === null ? 'BPM unknown' : `${delta > 0 ? '+' : ''}${delta} BPM`,
      compatible === null
        ? 'Key unknown'
        : compatible
          ? 'Compatible key'
          : 'Key change',
    ].join(' · '),
  };
};
