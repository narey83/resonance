import * as network from '../../lib/network';
import * as reports from '../../lib/reports';

export const MAP_PEER_LIMIT = 5_000;
const GEO_BATCH_SIZE = 2_000;

export const hasCoordinates = (peer) => peer?.lat != null && peer?.lon != null;

// Respect the server's batch cap rather than silently losing peers after IP 2,000.
export const lookupLocations = async (ips, signal) => {
  const unique = [...new Set(ips.filter(Boolean))];
  const locations = {};
  for (let offset = 0; offset < unique.length; offset += GEO_BATCH_SIZE) {
    if (signal?.aborted) return locations;
    Object.assign(
      locations,
      await network.batchLookup(unique.slice(offset, offset + GEO_BATCH_SIZE), {
        signal,
      }),
    );
  }

  return locations;
};

export const loadMapPeers = async ({
  start,
  end,
  signal,
  onPeers,
  onTotal,
  onReady,
}) => {
  // A map needs a bounded set, not ten table pages that each reaggregate history.
  const page = await reports.getUserList({
    start,
    end,
    limit: MAP_PEER_LIMIT,
    offset: 0,
    sortBy: 'LastSeen',
    signal,
  });
  if (signal.aborted) return;
  const users = (page.items ?? []).map((user) => ({
    ...user,
    ip: user.ipAddress,
    browseCount: 0,
    chatCount: 0,
  }));
  let peers = users.filter(hasCoordinates);
  onTotal(page.total);
  onPeers(peers);
  onReady();
  const publish = () => {
    if (!signal.aborted) onPeers(peers);
  };

  // Optional details never hold back already located peers or each other.
  await Promise.allSettled([
    (async () => {
      const missing = users.filter((user) => !hasCoordinates(user) && user.ip);
      const locations = await lookupLocations(
        missing.map((user) => user.ip),
        signal,
      );
      if (signal.aborted) return;
      peers = [
        ...peers,
        ...missing
          .filter((user) => hasCoordinates(locations[user.ip]))
          .map((user) => ({ ...user, ...locations[user.ip] })),
      ];
      publish();
    })(),
    (async () => {
      const usernames = [
        ...new Set(users.map((user) => user.username).filter(Boolean)),
      ];
      if (usernames.length === 0) return;
      const counts = await reports.getUserEventCounts({
        usernames,
        start,
        signal,
      });
      if (signal.aborted) return;
      // Keep enrichment for peers whose coordinates arrive after event counts.
      for (const user of users)
        Object.assign(user, counts[user.username] ?? {});
      peers = peers.map((peer) => ({ ...peer, ...counts[peer.username] }));
      publish();
    })(),
  ]);
};

export const locateLivePeers = async (peers, cache, signal, onLocations) => {
  const missing = peers.filter((peer) => !cache.has(peer.ip));
  if (missing.length > 0) {
    const locations = await lookupLocations(
      missing.map((peer) => peer.ip),
      signal,
    );
    if (signal.aborted) return [];
    for (const peer of missing) {
      if (hasCoordinates(locations[peer.ip]))
        cache.set(peer.ip, locations[peer.ip]);
    }

    // Reveal local hits while slower fallback lookups are still running.
    onLocations?.(
      peers
        .filter((peer) => hasCoordinates(cache.get(peer.ip)))
        .map((peer) => ({ ...peer, ...cache.get(peer.ip) })),
    );
    // Fallback only for local misses; cap concurrent external lookups at four.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, missing.length) }, async () => {
        while (next < missing.length && !signal.aborted) {
          const peer = missing[next++];
          let location = locations[peer.ip] ?? null;
          if (!location) {
            try {
              location = await network.lookupIp(peer.ip, { signal });
            } catch {
              /* Cache unsuccessful lookups too. */
            }
          }

          if (!signal.aborted) cache.set(peer.ip, location);
        }
      }),
    );
  }

  return peers
    .filter((peer) => hasCoordinates(cache.get(peer.ip)))
    .map((peer) => ({ ...peer, ...cache.get(peer.ip) }));
};
