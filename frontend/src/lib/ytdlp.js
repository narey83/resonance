import api from './api';

// Mix-length presets mapping a DJ/electronic "mix type" to a duration range.
// maxSeconds 0 = no upper bound (matches the backend min/max convention).
export const DURATION_PRESETS = [
  { value: 'radio', label: 'Radio mix', minSeconds: 150, maxSeconds: 300 },
  {
    value: 'extended',
    label: 'Extended mix',
    minSeconds: 300,
    maxSeconds: 600,
  },
  { value: 'set', label: 'Set', minSeconds: 1_800, maxSeconds: 0 },
];

export const listJobs = () => api.get('/ytdlp/jobs');
export const submitJob = ({
  url,
  outputDirectory,
  audioFormat,
  audioQuality,
  defaultGenre,
  minTrackDurationSeconds,
  maxTrackDurationSeconds,
  convertOnCompletionFormat,
  uploadedAfter,
}) =>
  api.post('/ytdlp/jobs', {
    url,
    outputDirectory,
    audioFormat,
    audioQuality,
    defaultGenre,
    minTrackDurationSeconds,
    maxTrackDurationSeconds,
    convertOnCompletionFormat,
    uploadedAfter,
  });
export const getJobTracks = (jobId) => api.get(`/ytdlp/jobs/${jobId}/tracks`);
export const removeJob = (jobId) => api.delete(`/ytdlp/jobs/${jobId}`);
export const cancelJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/cancel`);
export const pauseJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/pause`);
export const resumeJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/resume`);
export const retryFailedTracks = (jobId) =>
  api.post(`/ytdlp/jobs/${jobId}/retry-failed`);
export const reconcileJob = (jobId) =>
  api.post(`/ytdlp/jobs/${jobId}/reconcile`);

export const cancelTrack = (trackId) => api.delete(`/ytdlp/tracks/${trackId}`);
export const getTagErrors = () => api.get('/ytdlp/tag-errors');
export const retryTags = (trackId) =>
  api.post(`/ytdlp/tracks/${trackId}/retry-tags`);

export const search = (
  q,
  { duration, limit = 25, sort, type, uploadDate } = {},
) => {
  const params = new URLSearchParams({ limit, q });
  if (type) params.append('type', type);
  if (duration) params.append('duration', duration);
  if (uploadDate) params.append('uploadDate', uploadDate);
  if (sort) params.append('sort', sort);
  return api.get(`/ytdlp/search?${params.toString()}`);
};

export const listSubscriptions = () => api.get('/ytdlp/subscriptions');
export const addSubscription = ({
  channelUrl,
  outputDirectory,
  audioFormat,
  audioQuality,
  defaultGenre,
  minTrackDurationSeconds,
  maxTrackDurationSeconds,
  convertOnCompletionFormat,
  uploadedAfter,
} = {}) =>
  api.post('/ytdlp/subscriptions', {
    channelUrl,
    outputDirectory,
    audioFormat,
    audioQuality,
    defaultGenre,
    minTrackDurationSeconds,
    maxTrackDurationSeconds,
    convertOnCompletionFormat,
    uploadedAfter,
  });
export const updateSubscription = (id, changes) =>
  api.patch(`/ytdlp/subscriptions/${id}`, changes);
export const removeSubscription = (id) =>
  api.delete(`/ytdlp/subscriptions/${id}`);
export const checkSubscription = (id) =>
  api.post(`/ytdlp/subscriptions/${id}/check`);

export const getVersions = () => api.get('/ytdlp/versions');
export const checkForUpdate = () => api.get('/ytdlp/update-check');
export const installUpdate = () => api.post('/ytdlp/update');

export const backfillDurations = () => api.post('/ytdlp/backfill-durations');

export const getCookieStatus = () => api.get('/ytdlp/cookies');
export const uploadCookies = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/ytdlp/cookies', fd);
};

export const deleteCookies = () => api.delete('/ytdlp/cookies');
