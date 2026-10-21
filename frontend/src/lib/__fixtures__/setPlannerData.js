export const makeSetTrack = (name, bpm = 120) => ({
  track: {
    path: `/library/${name}.mp3`,
    title: name,
    artist: 'Test artist',
    duration: 240,
    bpm,
    key: 'Am',
    genre: 'House',
    lufs: -10,
  },
  enhanced: {
    available: true,
    durationSeconds: 240,
    downbeats: Array.from(
      { length: Math.floor(bpm) + 1 },
      (_, i) => (i * 240) / bpm,
    ),
    beats: Array.from(
      { length: Math.floor(bpm * 4) + 1 },
      (_, i) => (i * 60) / bpm,
    ),
    singing: [],
    processedVoice: [],
    djPhrases: [],
  },
});
export const setTracks = [
  makeSetTrack('Opener'),
  makeSetTrack('Middle', 128),
  makeSetTrack('Closer', 124),
];
export const savedSet = {
  id: '11111111111111111111111111111111',
  name: 'Test set',
  revision: 1,
  items: setTracks
    .slice(0, 2)
    .map(({ track }) => ({ path: track.path, masterBpm: null, note: '' })),
  initialMasterBpm: null,
  bars: 16,
  extendedTempo: false,
  notes: '',
  archived: false,
};
export const setData = Object.fromEntries(
  setTracks.map((data) => [data.track.path, data]),
);
