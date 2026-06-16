import { harmonicNeighbours } from './camelot';

const shuffleArray = (array) => {
  const result = [...array];

  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));

    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
};

/**
 * Builds a harmonically compatible queue from a pool of keyed tracks.
 * @param {object} seed - { key, bpm, path } — the starting track
 * @param {object[]} pool - all keyed MusicTrack objects from the library
 * @param {object} [options]
 * @param {number} [options.bpmTolerance] - fraction tolerance for BPM matching (±8%)
 * @param {number} [options.count] - max queue length
 * @returns {object[]} ordered mix tracks
 */
export const buildAutoMix = (
  seed,
  pool,
  { bpmTolerance = 0.08, count = 30 } = {},
) => {
  if (!seed?.key || !pool?.length) return [];

  const compatibleKeys = harmonicNeighbours(seed.key);
  const candidates = pool.filter(
    (track) =>
      track.key && compatibleKeys.has(track.key) && track.path !== seed.path,
  );

  if (!candidates.length) return [];

  if (seed.bpm && seed.bpm > 0) {
    const bpmLow = seed.bpm * (1 - bpmTolerance);
    const bpmHigh = seed.bpm * (1 + bpmTolerance);
    const withinBpm = candidates.filter(
      (track) => track.bpm && track.bpm >= bpmLow && track.bpm <= bpmHigh,
    );
    const outOfBpm = candidates.filter(
      (track) => !track.bpm || track.bpm < bpmLow || track.bpm > bpmHigh,
    );

    return [...shuffleArray(withinBpm), ...shuffleArray(outOfBpm)].slice(
      0,
      count,
    );
  }

  return shuffleArray(candidates).slice(0, count);
};
