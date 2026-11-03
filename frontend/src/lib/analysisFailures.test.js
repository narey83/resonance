import {
  basicRecoveryCandidates,
  failedTracksFromLogs,
} from './analysisFailures';

const event = (
  properties,
  message = 'Analysis measurement failed for a track',
) => ({
  message,
  properties: JSON.stringify(properties),
  timestamp: '2026-11-02T12:00:00Z',
  context: 'Music / Enhanced Analysis',
});

describe('analysis failure history', () => {
  it('groups failed measurements by track and mode without duplicating repeated logs', () => {
    expect.hasAssertions();
    const input = [
      event({
        Path: '/music/song.mp3',
        Measurement: 'energy',
        Reason: 'Model missing',
      }),
      event({
        Path: '/music/song.mp3',
        Measurement: 'genre',
        Reason: 'Inference failed',
      }),
    ];
    const rows = failedTracksFromLogs([...input, input[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0].failures).toEqual([
      { measurement: 'Energy', reason: 'Model missing' },
      { measurement: 'Genre', reason: 'Inference failed' },
    ]);
    expect(rows[0].mode).toBe('Enhanced');
  });
  it('reads Basic missing-metric flags and legacy decoder failures', () => {
    expect.hasAssertions();
    const rows = failedTracksFromLogs([
      {
        ...event(
          { File: '/music/basic.mp3', Metrics: 'Bpm, Key' },
          "Analysis failed for '/music/basic.mp3'; missing requested measurements",
        ),
        context: 'Music / Analysis',
      },
      event(
        null,
        "Analysis produced nothing for '/music/broken.mp3' — could not decode it.",
      ),
    ]);
    expect(rows[0].failures.map((failure) => failure.measurement)).toEqual([
      'BPM',
      'Key',
    ]);
    expect(rows[1].path).toBe('/music/broken.mp3');
    expect(rows[1].failures[0].measurement).toBe('Not recorded');
  });
  it('ignores unrelated warnings and handles malformed historic properties', () => {
    expect.hasAssertions();
    const rows = failedTracksFromLogs([
      { message: 'Could not refresh analysed track', properties: '{}' },
      { message: "Analysis failed for 'old.mp3': error", properties: '{bad' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('old.mp3');
    expect(rows[0].failures[0].measurement).toBe('Not recorded');
  });
});

describe('Basic analysis recovery', () => {
  it('identifies only newer full Basic successes and requires resolution for legacy names', () => {
    const tracks = [
      {
        key: 'a',
        mode: 'Basic',
        path: 'song.mp3',
        timestamp: '2026-11-01T12:00:00Z',
      },
      {
        key: 'b',
        mode: 'Basic',
        path: '/music/song.mp3',
        timestamp: '2026-11-03T12:00:00Z',
      },
      {
        key: 'c',
        mode: 'Enhanced',
        path: '/music/song.mp3',
        timestamp: '2026-11-01T12:00:00Z',
      },
    ];
    const saved = {
      message: 'Analysis saved for song',
      timestamp: '2026-11-02T12:00:00Z',
      properties: { File: '/music/song.mp3', Metrics: 'All' },
    };
    expect(basicRecoveryCandidates(tracks, [saved])).toEqual([
      { track: tracks[0], path: '/music/song.mp3', needsResolution: true },
    ]);
    expect(
      basicRecoveryCandidates(tracks, [
        saved,
        {
          ...saved,
          properties: { ...saved.properties, File: '/other/song.mp3' },
        },
      ]),
    ).toEqual([]);
    expect(
      basicRecoveryCandidates(tracks, [
        { ...saved, properties: { ...saved.properties, Metrics: 'Loudness' } },
      ]),
    ).toEqual([]);
  });
});
