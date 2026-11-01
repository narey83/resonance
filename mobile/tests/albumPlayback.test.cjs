const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');

const song = (artist, title, directory, extra = {}) => ({
  path: `${directory}/${title}.mp3`, directory, artist, title, album: 'HYS007', albumArtist: artist, ...extra,
});
function setup(rows, override = {}) {
  const calls = [];
  const load = mobileModules({
    'src/api/musicLibrary.ts': { getTracks: async params => {
      calls.push(params);
      const tracks = rows.filter(t => t.album === params.album && (!params.folder || t.directory === params.folder));
      return { tracks: tracks.slice(params.offset, params.offset + params.limit), total: tracks.length };
    }, ...override },
    'src/api/discovery.ts': { resolveTracks: async paths => rows.filter(t => paths.includes(t.path)) },
  });
  return { get: load('src/services/albumTracks.ts').getAlbumTracks, calls, load };
}

test('the first four HYS007 arrival cards select their own artist instead of the shared first track', async () => {
  const rows = [song('Brusca', 'Above, Below', 'TECHNO ZONE'), song('Fresko', 'Monumento', 'TECHNO ZONE'),
    song('Pierce', 'Halftime', 'TECHNO ZONE'), song('Uväll', 'Parallel Shift', 'TECHNO ZONE'),
    song('Brusca', 'Above, Below', 'HATE', { albumArtist: null }), song('Fresko', 'Monumento', 'HATE'),
    song('Pierce', 'Halftime', 'HATE', { albumArtist: null })];
  const cards = rows.slice(0, 4).map(t => ({ album: t.album, artist: t.artist, albumArtist: t.albumArtist,
    directory: t.directory, coverPath: t.path, trackCount: 1 }));
  // The current server backfills HATE's missing album-artist tags from Fresko.
  cards[1] = { ...cards[1], directory: 'HATE', trackCount: 7 };
  const { get } = setup(rows);
  const queues = await Promise.all(cards.map(card => get(card)));
  assert.deepEqual(queues.map(queue => queue[0].title), ['Above, Below', 'Monumento', 'Halftime', 'Parallel Shift']);
  assert.deepEqual(queues.map(queue => queue.length), [1, 1, 1, 1]);
});

test('compilations retain tagged and untagged performers and named albums retain tagged guests', async () => {
  const rows = [song('First', 'one', 'comp', { albumArtist: 'Various Artists' }),
    song('Second', 'two', 'comp', { albumArtist: null }), song('Other', 'wrong', 'comp'),
    song('Guest', 'guest', 'named', { albumArtist: 'Lead' })];
  const { get } = setup(rows);
  assert.deepEqual((await get({ album: 'HYS007', artist: 'Various Artists', albumArtist: 'Various Artists', directory: 'comp' })).map(t => t.title), ['one', 'two']);
  assert.deepEqual((await get({ album: 'HYS007', artist: 'Lead', albumArtist: 'Lead', directory: 'named' })).map(t => t.title), ['guest']);
});

test('pagination finds matching artists beyond the first page and honors the requested queue limit', async () => {
  const rows = Array.from({ length: 450 }, (_, i) => song(i === 205 || i === 405 ? 'Wanted' : 'Other', `track-${i}`, 'shared'));
  const { get, calls } = setup(rows);
  const tracks = await get({ album: 'HYS007', artist: 'Wanted', directory: 'shared' }, 2);
  assert.deepEqual(tracks.map(t => t.title), ['track-205', 'track-405']);
  assert.deepEqual(calls.map(c => c.offset), [0, 200, 400]);
});

test('an unavailable album never falls back to a different artist', async () => {
  const { get } = setup([song('Other', 'wrong', 'shared')]);
  assert.deepEqual(await get({ album: 'HYS007', artist: 'Wanted', directory: 'shared', trackCount: 1, coverPath: 'missing.mp3' }), []);
});

test('account changes discard an in-flight album request', async () => {
  const response = deferred(); const { get, load } = setup([], { getTracks: () => response.promise });
  const pending = get({ album: 'HYS007', artist: 'Wanted', directory: 'shared' });
  load('src/lib/sessionScope.ts').resetSessionScope('new-account');
  response.resolve({ tracks: [song('Wanted', 'one', 'shared')], total: 1 });
  await assert.rejects(pending, /Session changed/);
});
