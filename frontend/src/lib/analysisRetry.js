import api from './api';

const normalise = (path) => path.replaceAll('\\', '/').toLowerCase();

// Old Basic logs recorded basenames. Enumerate directory names, then resolve
// candidate paths in bounded batches; title search cannot prove filename uniqueness.
export const resolveFailedTrackPaths = async (entries, { signal } = {}) => {
  const references = [...new Set(entries.map((entry) => entry.path))];
  if (!references.length || references.length > 100)
    throw new Error('Choose between 1 and 100 failed tracks to retry.');
  const names = references.filter((path) => !/[/\\]/.test(path));
  const candidates = references.filter((path) => /[/\\]/.test(path));
  if (names.length) {
    const { data: folders } = await api.get('/musiclibrary/folders', {
      signal,
      timeout: 10_000,
    });
    if (!Array.isArray(folders))
      throw new Error('The library folders could not be loaded. Try again.');
    if (folders.length * names.length > 100_000)
      throw new Error(
        'Too many folders for filename-only retry. Select the files in Analyse tracks instead.',
      );
    for (const folder of folders) {
      if (typeof folder.path !== 'string') continue;
      for (const name of names)
        candidates.push(`${folder.path.replace(/[/\\]+$/, '')}/${name}`);
    }
  }

  const resolved = new Map();
  const unique = [...new Set(candidates)];
  for (let offset = 0; offset < unique.length; offset += 200) {
    const { data } = await api.post(
      '/musiclibrary/resolve',
      unique.slice(offset, offset + 200),
      { signal, timeout: 10_000 },
    );
    if (!Array.isArray(data))
      throw new Error('The library paths could not be resolved. Try again.');
    for (const track of data) {
      if (typeof track.path === 'string') resolved.set(track.path, track);
    }
  }

  const paths = [];
  for (const reference of references) {
    const wanted = normalise(reference);
    const full = /[/\\]/.test(reference);
    const relative = full && !wanted.startsWith('/') && !/^[a-z]:/.test(wanted);
    const matches = [...resolved.values()].filter((track) => {
      const path = normalise(track.path);
      return full
        ? path === wanted || (relative && path.endsWith(`/${wanted}`))
        : path.split('/').pop() === wanted;
    });
    if (matches.length !== 1)
      throw new Error(
        matches.length > 1
          ? `Several library tracks match ${reference}. Select the correct file in Analyse tracks instead.`
          : `${reference} could not be found in the library. No retry was started.`,
      );
    paths.push(matches[0].path);
  }

  return [...new Set(paths)];
};
