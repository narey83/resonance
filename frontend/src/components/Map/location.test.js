import {
  clusterVisiblePeers,
  isLocated,
  radialOffsets,
  validCoordinates,
} from './location';

const project = ([, lon], zoom) => ({ x: lon * zoom * 1_000, y: 0 });

describe('map coordinates', () => {
  it('accepts the equator and international date line', () => {
    expect(validCoordinates(0, 0)).toBe(true);
    expect(validCoordinates(-90, 180)).toBe(true);
  });

  it('rejects missing, malformed, and out-of-range locations', () => {
    expect(isLocated({ lat: null, lon: null })).toBe(false);
    expect(isLocated({ lat: 51, lon: undefined })).toBe(false);
    expect(isLocated({ lat: '51', lon: 0 })).toBe(false);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates(0, -181)).toBe(false);
  });

  it('separates close peers as zoom increases and skips invalid points', () => {
    const peers = [
      { username: 'a', lat: 51, lon: 0 },
      { username: 'b', lat: 51, lon: 0.01 },
      { username: 'missing', lat: null, lon: null },
    ];
    const bounds = { contains: () => true };
    expect(clusterVisiblePeers(peers, bounds, project, 1, 42)).toHaveLength(1);
    expect(clusterVisiblePeers(peers, bounds, project, 10, 42)).toHaveLength(2);
  });

  it('spreads every grouped peer into separate clock positions and rings', () => {
    expect(radialOffsets(0)).toEqual([]);
    expect(radialOffsets(4)).toEqual([
      { x: 0, y: -56 },
      { x: 56, y: 0 },
      { x: 0, y: 56 },
      { x: -56, y: 0 },
    ]);
    const many = radialOffsets(40);
    expect(many).toHaveLength(40);
    expect(new Set(many.map(({ x, y }) => `${x}:${y}`)).size).toBe(40);
    expect(many[8]).toEqual({ x: 0, y: -98 });
  });
});
