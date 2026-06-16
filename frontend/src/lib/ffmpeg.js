import api from './api';

export const getVersion = () => api.get('/ffmpeg/version');
export const checkForUpdate = () => api.get('/ffmpeg/update-check');
export const installUpdate = () => api.post('/ffmpeg/update');
