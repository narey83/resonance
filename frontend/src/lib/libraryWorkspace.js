import api from './api';
import { harmonicNeighbours } from './camelot';
import { seedSignatures } from './streamSignatures';

export const getCrates = async () =>
  (await api.get('/musiclibrary/crates')).data.crates;
export const getCratePage = async ({ crateId, ...params }) => {
  const { data } = await api.get(
    `/musiclibrary/crates/${encodeURIComponent(crateId)}/tracks`,
    { params },
  );
  seedSignatures(data.tracks);
  return { items: data.tracks, total: data.total };
};

export const previewCrate = async (rules) =>
  (await api.post('/musiclibrary/crates/preview', rules)).data;
export const saveCrate = async (crate) =>
  (
    await (crate.id
      ? api.put(`/musiclibrary/crates/${encodeURIComponent(crate.id)}`, crate)
      : api.post('/musiclibrary/crates', crate))
  ).data;
export const deleteCrate = async (crate) =>
  api.delete(`/musiclibrary/crates/${encodeURIComponent(crate.id)}`, {
    params: { revision: crate.revision },
  });
export const getPreparationStatus = async () =>
  (await api.get('/musiclibrary/preparation/status')).data;
export const getPreparationPage = async (params) => {
  const { data } = await api.get('/musiclibrary/preparation', { params });
  seedSignatures(data.items.map((item) => item.track));
  return { items: data.items, total: data.total };
};

export const pausePreparation = async (paused) =>
  api.post('/musiclibrary/preparation/pause', { paused });
export const retryPreparation = async (path) =>
  api.post('/musiclibrary/preparation/retry', { path });
export const workspaceError = (error) =>
  error?.response?.data?.message ||
  'Could not reach the library. Please try again.';

export const crateRuleLabels = (rules = {}) => {
  const labels = [];
  if (rules.bpmMin || rules.bpmMax)
    labels.push(
      `${rules.bpmMin || '20'}–${rules.bpmMaxExclusive ? '<' : ''}${rules.bpmMax || '400'} BPM`,
    );
  if (rules.keys?.length) labels.push(`Keys: ${rules.keys.join(', ')}`);
  if (rules.genre) labels.push(rules.genre);
  if (rules.vocals)
    labels.push(rules.vocals === 'no' ? 'No voice detected' : 'Voice detected');
  if (rules.energy) labels.push(`${rules.energy} RMS energy`);
  if (rules.addedWithinDays)
    labels.push(`Added within ${rules.addedWithinDays} days`);
  if (rules.neverPlayed) labels.push('Never played');
  else if (rules.notPlayedWithinDays)
    labels.push(`Not played in ${rules.notPlayedWithinDays} days`);
  if (rules.lovedOnly) labels.push('Loved tracks');
  if (rules.analysis)
    labels.push(
      {
        enhanced: 'Enhanced analysis',
        pending: 'Enhanced pending',
        complete: 'Basic analysis complete',
        incomplete: 'Basic analysis incomplete',
      }[rules.analysis],
    );
  if (rules.analysedOnly) labels.push('Saved analysis available');
  if (rules.folder)
    labels.push(`Folder: ${rules.folder.split(/[/\\]/).filter(Boolean).pop()}`);
  return labels.length ? labels : ['All tracks'];
};

export const formRules = (form) => ({
  analysedOnly: Boolean(form.analysedOnly),
  bpmMaxExclusive: Boolean(form.bpmMaxExclusive),
  bpmMin: form.bpmMin === '' ? null : Number(form.bpmMin),
  bpmMax: form.bpmMax === '' ? null : Number(form.bpmMax),
  keys: form.key
    ? [...harmonicNeighbours(form.key)]
    : form.keys?.length
      ? form.keys
      : null,
  genre: form.genre || null,
  vocals: form.vocals || null,
  energy: form.energy || null,
  analysis: form.analysis || null,
  folder: form.folder || null,
  addedWithinDays:
    form.addedWithinDays === '' ? null : Number(form.addedWithinDays),
  notPlayedWithinDays:
    form.notPlayedWithinDays === '' ? null : Number(form.notPlayedWithinDays),
  neverPlayed: form.neverPlayed,
  lovedOnly: form.lovedOnly,
});
export const preparationLabel = (state) =>
  ({
    analysed: 'All analysed',
    waiting: 'All waiting',
    complete: 'Analysed',
    basic: 'Basic analysed',
    queued: 'Queued',
    running: 'Analysing',
    retrying: 'Retry scheduled',
    failed: 'Needs attention',
  })[state] || 'Checking';
