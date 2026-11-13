const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');

function setup(overrides = {}) {
  const library = deferred(), arrivals = deferred(), history = deferred(), resolved = deferred();
  const albumTracks = deferred();
  const requests = [], published = {};
  let active = true;
  const load = mobileModules({
    'src/api/musicLibrary.ts': {
      getTracks: params => { requests.push(params); return params.album ? albumTracks.promise : library.promise; },
      getRecentlyAdded: () => arrivals.promise,
      ...overrides,
    },
    'src/api/libraryActivity.ts': { getPlayHistory: () => history.promise },
    'src/api/discovery.ts': { resolveTracks: () => resolved.promise },
  });
  const sections = { current: () => active };
  for (const name of ['tracks', 'albums', 'fresh', 'history', 'recent', 'historyFeature']) {
    sections[name] = value => { published[name] = value; };
  }
  sections.libraryError = () => { published.error = true; };
  const done = load('src/services/discoveryPlayback.ts').loadDiscoveryPlayback(sections);
  const finish = async () => {
    library.resolve({ tracks: [] }); arrivals.resolve([]); history.resolve([]); resolved.resolve([]); albumTracks.resolve({ tracks: [], total: 0 });
    await done;
  };
  return { library, arrivals, history, resolved, albumTracks, published, requests, done, finish, cancel: () => { active = false; } };
}

test('library tracks are playable while arrivals and history are still pending', async () => {
  const ui = setup(); let complete = false; ui.done.then(() => { complete = true; });
  const tracks = [{ path: 'song.flac' }];
  ui.library.resolve({ tracks }); await tick();
  assert.equal(ui.published.tracks, tracks);
  assert.equal(complete, false);
  assert.equal(ui.published.albums, undefined);
  await ui.finish();
});

test('new album tracks start loading immediately and partial failures preserve playable results', async () => {
  const ui = setup();
  const albums = [{ album: 'Album', artist: 'Artist' }];
  ui.arrivals.resolve(albums); await tick();
  assert.equal(ui.published.albums, albums);
  assert.equal(ui.requests[1].album, 'Album');
  const track = { path: 'new.flac', album: 'Album', artist: 'Artist' };
  ui.albumTracks.resolve({ tracks: [track, track], total: 2 }); await tick();
  assert.deepEqual(ui.published.fresh, [track]);
  ui.history.reject(new Error('history unavailable'));
  ui.library.reject(new Error('library unavailable')); await ui.done;
  assert.equal(ui.published.error, true);
  assert.deepEqual(ui.published.fresh, [track]);
  assert.equal(ui.published.historyFeature, null);
});

test('a cancelled refresh cannot publish sections or start dependent requests', async () => {
  const ui = setup(); ui.cancel(); await ui.finish();
  assert.deepEqual(ui.published, {});
  assert.equal(ui.requests.length, 1);
});

test('resolved history is published without waiting for library or arrivals', async () => {
  const ui = setup(); const plays = [{ path: 'played.flac' }, { path: 'older.flac' }];
  ui.history.resolve(plays); await tick();
  assert.equal(ui.published.history, plays);
  assert.equal(ui.published.historyFeature, undefined, 'the cover waits for resolved play history');
  const tracks = [{ path: 'played.flac' }, { path: 'older.flac' }]; ui.resolved.resolve(tracks); await tick();
  assert.equal(ui.published.recent, tracks);
  assert.deepEqual(ui.published.historyFeature, { track: tracks[0], hasHistory: true });
  await ui.finish();
});

test('missing newest track does not feature an older play', async () => {
  const ui = setup();
  ui.history.resolve([{ path: 'missing.flac' }, { path: 'older.flac' }]); await tick();
  ui.resolved.resolve([{ path: 'older.flac' }]); await tick();
  assert.deepEqual(ui.published.historyFeature, { track: null, hasHistory: true });
  await ui.finish();
});
