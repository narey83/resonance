export const validCoordinates = (lat, lon) =>
  typeof lat === 'number' &&
  typeof lon === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= -90 &&
  lat <= 90 &&
  lon >= -180 &&
  lon <= 180;

export const isLocated = (peer) =>
  peer != null && validCoordinates(peer.lat, peer.lon);

export const clusterVisiblePeers = (peers, bounds, project, zoom, cellSize) => {
  const cells = new Map();
  for (const peer of peers) {
    if (!isLocated(peer) || !bounds.contains([peer.lat, peer.lon])) continue;
    const point = project([peer.lat, peer.lon], zoom);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(peer);
  }

  return [...cells.values()];
};
