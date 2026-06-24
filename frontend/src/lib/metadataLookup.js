import api from './api';

export const getStatus = async () => {
  return (await api.get('/metadatalookup/status')).data;
};

export const lookup = async ({ maskedFilename, artist, title, album } = {}) => {
  return (
    await api.post('/metadatalookup/lookup', {
      maskedFilename,
      artist,
      title,
      album,
    })
  ).data;
};

export const runNow = async () => {
  return (await api.post('/metadatalookup/run')).data;
};
