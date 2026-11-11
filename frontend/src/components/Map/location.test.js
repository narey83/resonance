import { clusterVisiblePeers, isLocated, validCoordinates } from './location';

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
});
