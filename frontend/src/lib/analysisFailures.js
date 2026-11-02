const labels = {
  bpm: 'BPM',
  key: 'Key',
  waveform: 'Waveform',
  loudness: 'Loudness',
  beats: 'Beat grid',
  semanticPhrases: 'Phrase structure',
  vocalPresence: 'Vocal presence',
  vocalActivity: 'Vocal activity',
  stems: 'Stems',
  genre: 'Genre',
  energy: 'Energy',
  cues: 'Cues',
  loops: 'Loops',
};

export const failedTracksFromLogs = (logs) => {
  const tracks = new Map();
  for (const log of logs) {
    const message = log.message || '';
    if (
      !/analysis (?:measurement failed|worker failed|failed|incomplete|produced nothing)|essentia produced no/i.test(
        message,
      )
    )
      continue;
    let properties;
    try {
      properties =
        typeof log.properties === 'string'
          ? JSON.parse(log.properties)
          : log.properties;
    } catch {
      properties = null;
    }

    const p = properties && typeof properties === 'object' ? properties : {};
    const path =
      typeof p.Path === 'string'
        ? p.Path
        : typeof p.File === 'string'
          ? p.File
          : message.match(/(?:for|from) ["']([^"']+)["']/)?.[1];
    if (!path) continue;
    const mode =
      /enhanced/i.test(`${log.context || ''} ${log.subContext || ''}`) ||
      /enhanced analysis/i.test(message)
        ? 'Enhanced'
        : 'Basic';
    const key = `${mode}:${path}`;
    if (!tracks.has(key))
      tracks.set(key, {
        key,
        path,
        mode,
        timestamp: log.timestamp,
        failures: [],
        entries: [],
      });
    const track = tracks.get(key);
    const raw = p.Measurement || p.Metrics || p.Missing;
    const measurements =
      typeof raw === 'string'
        ? raw
            .split(/[,/|]/)
            .map((value) => value.trim())
            .filter(Boolean)
        : ['Not recorded'];
    const reason =
      p.Reason ||
      p.Error ||
      (p.ExitCode != null
        ? `Worker exited with code ${p.ExitCode}`
        : /produced nothing/i.test(message)
          ? 'Audio could not be decoded.'
          : 'No usable result was returned.');
    for (const measurement of measurements) {
      const label =
        labels[measurement] || labels[measurement.toLowerCase()] || measurement;
      const detail = typeof reason === 'string' ? reason : String(reason);
      if (
        !track.failures.some(
          (failure) =>
            failure.measurement === label && failure.reason === detail,
        )
      )
        track.failures.push({ measurement: label, reason: detail });
    }

    if (!track.entries.includes(message)) track.entries.push(message);
  }

  return [...tracks.values()].map((track) => ({
    ...track,
    failures: track.failures.some(
      (failure) => failure.measurement !== 'Not recorded',
    )
      ? track.failures.filter(
          (failure) => failure.measurement !== 'Not recorded',
        )
      : track.failures,
  }));
};
