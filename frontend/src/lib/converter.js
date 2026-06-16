import api from './api';

const pathToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));

// Formats the backend can transcode to (must mirror AudioConverter.FormatSpec).
export const CONVERT_FORMATS = [
  'mp3',
  'opus',
  'flac',
  'wav',
  'm4a',
  'aac',
  'ogg',
];

export const startConversion = async ({
  paths = [],
  folders = [],
  format,
  quality = 2,
}) =>
  (
    await api.post('/converter/jobs', {
      paths: paths.map(pathToBase64),
      folders: folders.map(pathToBase64),
      format,
      quality,
    })
  ).data;

export const getConversionJob = async (id) =>
  (await api.get(`/converter/jobs/${id}`)).data;

export const listConversionJobs = async () =>
  (await api.get('/converter/jobs')).data;

export const cancelConversion = async (id) =>
  api.post(`/converter/jobs/${id}/cancel`);
