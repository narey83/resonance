import { apiBaseUrl } from '../config';
import api from './api';

export const getAll = () => api.get('/mixtapes').then((r) => r.data);

export const create = ({ name, description }) =>
  api.post('/mixtapes', { name, description }).then((r) => r.data);

export const update = (id, { name, description }) =>
  api
    .put(`/mixtapes/${encodeURIComponent(id)}`, { name, description })
    .then((r) => r.data);

export const remove = (id) => api.delete(`/mixtapes/${encodeURIComponent(id)}`);

export const addTrack = (id, filePath) =>
  api
    .post(`/mixtapes/${encodeURIComponent(id)}/tracks`, { filePath })
    .then((r) => r.data);

export const removeTrack = (id, trackId) =>
  api.delete(
    `/mixtapes/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`,
  );

export const clearTracks = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/tracks`);

export const reorderTracks = (id, trackIds) =>
  api.put(`/mixtapes/${encodeURIComponent(id)}/tracks`, { trackIds });

export const publish = (id) =>
  api.post(`/mixtapes/${encodeURIComponent(id)}/publish`).then((r) => r.data);

export const unpublish = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/publish`);

export const soulseekShare = (id) =>
  api.post(`/mixtapes/${encodeURIComponent(id)}/soulseek`).then((r) => r.data);

export const soulseekUnshare = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/soulseek`);

// ── Public (no auth) ──────────────────────────────────────────────────────────

export const artworkUrl = (id) =>
  `${apiBaseUrl}/mixtapes/${encodeURIComponent(id)}/artwork`;

export const uploadArtwork = (id, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/mixtapes/${encodeURIComponent(id)}/artwork`, form);
};

export const deleteArtwork = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/artwork`);

export const getPublic = (token) =>
  api.get(`/public/mixtapes/${encodeURIComponent(token)}`).then((r) => r.data);

export const downloadTrackUrl = (token, trackId) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/tracks/${encodeURIComponent(trackId)}/download`;

export const publicArtworkUrl = (token) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/artwork`;

// ── M3U / zip exports ─────────────────────────────────────────────────────────

export const m3uUrl = (id) =>
  `${apiBaseUrl}/mixtapes/${encodeURIComponent(id)}/export.m3u`;

export const publicM3uUrl = (token) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/export.m3u`;

export const publicZipUrl = (token) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/download.zip`;
