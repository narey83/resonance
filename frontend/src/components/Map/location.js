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

// Place each member of a grouped marker on concentric clock faces. More peers
// get larger rings so their click targets remain separate at the current zoom.
export const radialOffsets = (count) => {
  const offsets = [];
  for (let ring = 0; offsets.length < count; ring += 1) {
    const slots = Math.min(count - offsets.length, 8 + ring * 4);
    const radius = 56 + ring * 42;
    for (let slot = 0; slot < slots; slot += 1) {
      const angle = -Math.PI / 2 + (2 * Math.PI * slot) / slots;
      offsets.push({
        x: Math.round(Math.cos(angle) * radius) || 0,
        y: Math.round(Math.sin(angle) * radius) || 0,
      });
    }
  }

  return offsets;
};
