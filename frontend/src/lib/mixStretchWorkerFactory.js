export const createMixWorker = () =>
  new Worker(new URL('mixStretch.worker.js', import.meta.url));
