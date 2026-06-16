import api from './api';

export const postLog = (level, ...args) => {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }

      return String(a);
    })
    .join(' ');

  api.post('/logs', { level, message }).catch(() => {});
};
