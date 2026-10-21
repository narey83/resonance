import api from './api';
import { mixCompatibility, mixDuration, mixPath } from './mixCompatibility';
import { syncPlan } from './mixSync';

export const MAX_SET_TRACKS = 200;
export const setRequest = (plan) => ({
  name: plan.name,
  items: plan.items.map(({ path, note = '' }) => ({
    path,
    masterBpm: null,
    note,
  })),
  initialMasterBpm: plan.initialMasterBpm ?? null,
  bars: plan.bars || 16,
  extendedTempo: Boolean(plan.extendedTempo),
  notes: plan.notes || '',
  revision: plan.revision || 0,
});
// The API omits null properties. Preserve the explicit first-track master
// representation when opening a saved set or receiving an autosave response.
const normaliseSet = (plan) => ({
  ...plan,
  initialMasterBpm: plan.initialMasterBpm ?? null,
  items: plan.items.map((item) => ({
    ...item,
    masterBpm: null,
  })),
});
export const getSets = async () => {
  const data = (await api.get('/musiclibrary/sets')).data;
  return { ...data, sets: data.sets.map(normaliseSet) };
};

export const saveSet = async (plan, copy = false) =>
  normaliseSet(
    (
      await (plan.id && !copy
        ? api.put(
            `/musiclibrary/sets/${encodeURIComponent(plan.id)}`,
            setRequest(plan),
          )
        : api.post('/musiclibrary/sets', setRequest(plan)))
    ).data,
  );
export const archiveSet = async (plan, archived) =>
  normaliseSet(
    (
      await api.post(
        `/musiclibrary/sets/${encodeURIComponent(plan.id)}/archive`,
        { revision: plan.revision, archived },
      )
    ).data,
  );
export const setMixtape = async (plan, requestId) =>
  (
    await api.post(
      `/musiclibrary/sets/${encodeURIComponent(plan.id)}/mixtape`,
      { revision: plan.revision, requestId },
    )
  ).data;
export const setError = (error) =>
  error?.response?.data?.message ||
  'Could not save this set. Your draft is kept; retry when the connection is available.';
export const validBpm = (value) =>
  Number.isFinite(value) && value >= 20 && value <= 400;
export const validSet = (plan) =>
  Boolean(
    plan?.name?.trim() &&
      plan.name.trim().length <= 80 &&
      !Array.from(plan.name).some(
        (character) =>
          character.codePointAt(0) < 32 ||
          (character.codePointAt(0) >= 127 && character.codePointAt(0) <= 159),
      ),
  );
export const appendSetTracks = (plan, tracks) => {
  const existing = new Set(plan.items.map((item) => item.path));
  const items = [...plan.items];
  for (const track of tracks) {
    const path = mixPath(track);
    if (path && !existing.has(path) && items.length < MAX_SET_TRACKS) {
      existing.add(path);
      items.push({ path, masterBpm: null, note: '' });
    }
  }

  return items.length === plan.items.length ? plan : { ...plan, items };
};

export const moveSetTrack = (plan, from, to) => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= plan.items.length ||
    to >= plan.items.length
  )
    return plan;
  const items = [...plan.items];
  items.splice(to, 0, items.splice(from, 1)[0]);
  items[0] = { ...items[0], masterBpm: null };
  return { ...plan, items };
};

export const insertSetTrack = (plan, track, index) => {
  const next = appendSetTracks(plan, [track]);
  return next.items.length === plan.items.length
    ? plan
    : moveSetTrack(
        next,
        next.items.length - 1,
        Math.min(index, next.items.length - 1),
      );
};

export const removeSetTrack = (plan, path) => {
  const items = plan.items.filter((item) => item.path !== path);
  if (items.length) items[0] = { ...items[0], masterBpm: null };
  return { ...plan, items };
};

// One master applies from the first track to the last. Legacy checkpoints
// never change the set tempo, including when loading an older saved draft.
export const plannedMasters = (plan, byPath) => {
  const master =
    plan.initialMasterBpm ?? byPath[plan.items[0]?.path]?.track?.bpm;
  return plan.items.map(() => (validBpm(master) ? master : null));
};

export const setTransitionMessages = (comparison, synced, loading, missing) => {
  const messages = [];
  if (!comparison.tempo.known)
    messages.push({ kind: 'unknown', text: 'Tempo unknown' });
  else if (!comparison.master.a.allowed || !comparison.master.b.allowed)
    messages.push({ kind: 'attention', text: 'Tempo outside preview range' });
  if (!comparison.key.known)
    messages.push({ kind: 'unknown', text: 'Key unknown' });
  else if (comparison.key.kind === 'contrast')
    messages.push({ kind: 'attention', text: 'Key contrast' });
  if (['cross', 'conflict'].includes(comparison.genre.kind))
    messages.push({
      kind: 'attention',
      text:
        comparison.genre.kind === 'cross'
          ? 'Genre mismatch'
          : 'Conflicting genre data',
      group: 'genre',
    });
  else if (!comparison.genre.known)
    messages.push({
      kind: 'unknown',
      text: 'Genre not confirmed',
      group: 'genre',
    });
  if (loading)
    messages.push({ kind: 'unknown', text: 'Loading timing and vocals' });
  else if (!comparison.voiceKnown)
    messages.push({ kind: 'unknown', text: 'Vocal analysis unavailable' });
  else if (comparison.plan?.overlapSeconds > 2)
    messages.push({
      kind: 'attention',
      text: `~${comparison.plan.overlapSeconds.toFixed(1)}s predicted vocal overlap`,
    });
  if (comparison.loudness.known && Math.abs(comparison.loudness.delta) > 3)
    messages.push({
      kind: 'attention',
      text: `${comparison.loudness.delta > 0 ? '+' : ''}${comparison.loudness.delta.toFixed(1)} LU level change`,
    });
  if (!loading && !missing && !synced.available)
    messages.push({
      kind: 'attention',
      text: 'Saved timing cannot sync in this range',
    });
  if (comparison.plan?.phaseUncertain)
    messages.push({ kind: 'unknown', text: 'Bar phase uncertain' });
  if (missing) messages.push({ kind: 'attention', text: 'Track unavailable' });
  return messages;
};

export const setOverview = (plan, byPath) => {
  const masters = plannedMasters(plan, byPath);
  const rows = plan.items.map((item, i) => ({
    ...item,
    data: byPath[item.path],
    master: masters[i],
  }));
  const transitions = rows.slice(0, -1).map((row, i) => {
    const next = rows[i + 1];
    const loading =
      !row.data || !next.data || row.data.loading || next.data.loading;
    const missing = Boolean(row.data?.missing || next.data?.missing);
    const comparison = mixCompatibility(
      row.data,
      next.data,
      plan.bars,
      row.master ?? Number.NaN,
      plan.extendedTempo,
    );
    const synced = syncPlan(
      row.data,
      next.data,
      comparison.plan,
      row.master,
      plan.extendedTempo,
    );
    const messages = setTransitionMessages(
      comparison,
      synced,
      loading,
      missing,
    );
    return {
      from: i,
      to: i + 1,
      comparison,
      synced,
      messages,
      loading,
      missing,
    };
  });

  let total = 0;
  let knownMusic = 0;
  let unknownDurations = 0;
  let previousEnd = 0;
  for (const [i, row] of rows.entries()) {
    const duration = mixDuration(row.data);
    if (!duration) unknownDurations++;
    knownMusic += duration;
    const previous = transitions[i - 1];
    const next = transitions[i];
    const entry = previous?.synced.available
      ? previous.comparison.plan.entry
      : null;
    const exit = next?.synced.available ? next.comparison.plan.exit : null;
    const start = entry?.start || 0;
    const end = exit?.end ?? duration;
    const rate =
      validBpm(row.data?.track?.bpm) && row.master
        ? row.master / row.data.track.bpm
        : 1;
    const overlap = entry ? (plan.bars * 240) / masters[i - 1] : 0;
    const entrySource = entry ? entry.end - entry.start : 0;
    row.span = Math.max(0, end - start - entrySource) / rate + overlap;
    row.start = Math.max(0, previousEnd - overlap);
    previousEnd = row.start + row.span;
    total = previousEnd;
    if (entry && exit && entry.end > exit.start) {
      next.messages.push({
        kind: 'attention',
        text: 'Handover windows overlap; shorten the transition',
      });
      next.crowded = true;
    }
  }

  return {
    rows,
    transitions,
    total,
    knownMusic,
    unknownDurations,
    provisional:
      rows.some(
        (row) =>
          !row.master ||
          !validBpm(row.data?.track?.bpm) ||
          row.data?.loading ||
          row.data?.missing,
      ) || transitions.some((t) => !t.synced.available || t.crowded),
    attention: transitions.filter((t) =>
      t.messages.some((message) => message.kind === 'attention'),
    ).length,
  };
};
