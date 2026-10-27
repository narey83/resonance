const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

const track = (index, path = `/music/${index}.flac`) => ({ path, title: `Track ${index}`, filename: `${index}.flac`, hasArtwork: false });
function setup({ count = 650, authenticated = true, quality = 'original', signed = true, albums = [], platform = 'android' } = {}) {
  let tree = {}, queue;
  const calls = [], signedPaths = [];
  const auth = { isReady: true, accessToken: authenticated ? 'token' : null, serverUrl: authenticated ? 'https://music.test' : null };
  const TrackPlayer = {
    setBrowseTree: async value => { tree = structuredClone(value); }, browseFailed: async id => calls.push(['failed', id]),
    setQueue: async value => { queue = value; calls.push(['queue']); },
    skip: async index => calls.push(['skip', index]), play: async () => calls.push(['play']),
  };
  const library = {
    getTracks: async query => { calls.push(['tracks', query]); return { total: count, tracks: Array.from({ length: Math.min(query.limit, count - (query.offset || 0)) }, (_, i) => track(i + (query.offset || 0))) }; },
    getArtworkUrl: () => 'https://music.test/cover', getAlbums: async () => albums, getTrackTitle: t => t.title, getStreamUrl: path => { calls.push(['url', path]); return `https://music.test/stream?path=${encodeURIComponent(path)}`; },
    currentStreamQuality: () => quality,
  };
  const load = mobileModules({
    'react-native': { Platform: { OS: platform }, NativeModules: { ResonanceCarPlay: { setBrowseTree: async value => { tree = structuredClone(value); }, browseFailed: async id => calls.push(['failed', id]) } } },
    'src/store/appModeStore.ts': { useAppMode: { getState: () => ({ loaded: true, mode: authenticated ? 'remote' : 'local' }) } },
    'react-native-track-player': { __esModule: true, default: TrackPlayer, MediaItemPlayable: { MediaPlayable: 'playable', MediaBrowsable: 'browsable' } },
    'src/lib/sessionScope.ts': { onSessionReset: () => {}, sessionGuard: () => () => true },
    'src/api/musicLibrary.ts': library,
    'src/api/streamSignatures.ts': { ensureSigned: async paths => { calls.push(['sign']); signedPaths.push(...paths); }, isSigned: () => signed },
    'src/services/artworkCache.ts': { ARTWORK_THUMB_SIZE: 192, PLAYER_ART_SIZE: 768 },
    'src/store/localPlaylistStore.ts': { useLocalPlaylistStore: { getState: () => ({ load: async () => {}, playlists: [{ id: 'local-check', name: 'Device list', tracks: [track(0, 'file:///music/local.flac')] }] }) } },
    'src/api/mixtapes.ts': {},
    'src/services/localMusicLibrary.ts': { isLocalPath: path => path.startsWith('file://') || path.startsWith('content://'), getAllLocalTracks: async () => [track(0, 'file:///music/local.flac')] },
    'src/store/auth.ts': { useAuthStore: { getState: () => auth, subscribe: () => () => {} } },
    'src/store/libraryActivityStore.ts': {}, 'src/store/localLibraryActivityStore.ts': {},
    'src/api/remoteLogger.ts': { remoteLog: (...args) => calls.push(['log', ...args]) },
  });
  return { aa: load('src/services/androidAuto.ts'), calls, signedPaths, tree: () => tree, queue: () => queue };
}

test('large albums expose every track through bounded, self-describing pages', async () => {
  const c = setup();
  await c.aa.handleAndroidAutoBrowse('aa:album:Artist%3AA|Album%7CB');
  const pages = c.tree()['aa:album:Artist%3AA|Album%7CB'];
  assert.equal(pages.length, 3);
  const paths = [];
  for (const page of pages) {
    await c.aa.handleAndroidAutoBrowse(page.mediaId);
    paths.push(...c.tree()[page.mediaId].map(item => item.mediaId));
  }
  assert.equal(new Set(paths).size, 650);
  assert.equal(paths.at(-1), '/music/649.flac');
  for (const [, query] of c.calls.filter(c => c[0] === 'tracks')) {
    assert.equal(query.artist, 'Artist:A'); assert.equal(query.album, 'Album|B'); assert.equal(query.limit, 300);
  }
});

test('artists without albums paginate rather than silently dropping tracks after 300', async () => {
  const c = setup(); await c.aa.handleAndroidAutoBrowse('aa:artist:Artist');
  assert.equal(c.tree()['aa:artist:Artist'].length, 3);
  const last = c.tree()['aa:artist:Artist'].at(-1);
  await c.aa.handleAndroidAutoBrowse(last.mediaId);
  assert.equal(c.tree()[last.mediaId].length, 50);
  assert.equal(c.calls.filter(c => c[0] === 'tracks').at(-1)[1].artist, 'Artist');
});

test('a car can reopen a saved album page after JS has restarted', async () => {
  const c = setup(); await c.aa.handleAndroidAutoBrowse('aa:page:600:b:Artist|Album');
  assert.equal(c.tree()['aa:page:600:b:Artist|Album'][0].mediaId, '/music/600.flac');
});

test('headless FLAC playback signs first and labels saver audio as MPEG', async () => {
  const c = setup({ quality: 'low' });
  await c.aa.playAndroidAutoMediaId('/music/history.flac');
  assert.deepEqual(c.signedPaths, ['/music/history.flac']);
  assert.equal(c.calls[0][0], 'sign');
  assert.equal(c.queue()[0].contentType, 'audio/mpeg');
  assert.ok(c.calls.some(call => call[0] === 'play'));
});

test('failed signing does not replace a working queue with an unauthorized stream', async () => {
  const c = setup({ signed: false }); await c.aa.playAndroidAutoMediaId('/music/history.flac');
  assert.equal(c.queue(), undefined); assert.ok(c.calls.some(call => call[0] === 'log'));
});

test('local-only car browsing and playback work without a remote login', async () => {
  const c = setup({ authenticated: false, quality: 'low' });
  await c.aa.buildAndroidAutoTree();
  assert.deepEqual(c.tree()['/'].map(item => item.mediaId), ['aa:local']);
  await c.aa.handleAndroidAutoBrowse('aa:local:tracks');
  assert.equal(c.tree()['aa:local:tracks'][0].mediaId, 'file:///music/local.flac');
  await c.aa.playAndroidAutoMediaId('file:///music/local.flac');
  assert.equal(c.queue()[0].url, 'file:///music/local.flac');
  assert.equal(c.queue()[0].contentType, 'audio/flac');
  assert.deepEqual(c.signedPaths, []);
});

test('compilation albums query their folder instead of an invented Various Artists performer', async () => {
  const c = setup({ count: 2, albums: [{ album: 'Compilation', artist: 'Various Artists', directory: '/music/collection', trackCount: 2 }] });
  await c.aa.handleAndroidAutoBrowse('aa:albums');
  const album = c.tree()['aa:albums'][0];
  await c.aa.handleAndroidAutoBrowse(album.mediaId);
  const query = c.calls.find(call => call[0] === 'tracks')[1];
  assert.equal(query.folder, '/music/collection'); assert.equal(query.album, 'Compilation'); assert.equal(query.artist, undefined);
});

test('artists with albums still expose tracks that have no album tag', async () => {
  const c = setup({ albums: [{ album: 'Album', artist: 'Artist', directory: '/music/album' }] });
  await c.aa.handleAndroidAutoBrowse('aa:artist:Artist');
  assert.equal(c.tree()['aa:artist:Artist'][0].title, 'All tracks');
  await c.aa.handleAndroidAutoBrowse(c.tree()['aa:artist:Artist'][0].mediaId);
  assert.equal(c.calls.find(call => call[0] === 'tracks')[1].artist, 'Artist');
});

test('a 24,935-track folder exposes its final page without increasing the per-folder limit', async () => {
  const c = setup({ count: 24935 });
  const folder = 'aa:folder:' + encodeURIComponent('/music/large:folder');
  await c.aa.handleAndroidAutoBrowse(folder);
  const pages = c.tree()[folder];
  assert.equal(pages.length, 84);
  const last = pages.at(-1);
  const fresh = setup({ count: 24935 });
  await fresh.aa.handleAndroidAutoBrowse(last.mediaId);
  assert.equal(fresh.tree()[last.mediaId].length, 35);
  assert.equal(fresh.tree()[last.mediaId].at(-1).mediaId, '/music/24934.flac');
  assert.equal(fresh.calls.find(call => call[0] === 'tracks')[1].folder, '/music/large:folder');
});

test('CarPlay publishes its local browser through the iOS bridge without Android APIs', async () => {
  const c = setup({ platform: 'ios', authenticated: false });
  await c.aa.buildAndroidAutoTree();
  await c.aa.handleAndroidAutoBrowse('aa:local:tracks');
  assert.deepEqual(c.tree()['/'].map(item => item.mediaId), ['aa:local']);
  assert.equal(c.tree()['aa:local:tracks'][0].mediaId, 'file:///music/local.flac');
  await c.aa.playAndroidAutoMediaId('file:///music/local.flac', true);
  assert.equal(c.queue()[0].url, 'file:///music/local.flac');
});
test('CarPlay reports unauthorized playback rather than showing a false Now Playing success', async () => {
  const c = setup({ platform: 'ios', authenticated: false });
  await assert.rejects(c.aa.playAndroidAutoMediaId('/server/track.flac', true), /Connect/);
  assert.equal(c.queue(), undefined);
});

test('car device playlists browse without authentication or server requests', async () => {
  const c = setup({ authenticated: false });
  await c.aa.handleAndroidAutoBrowse('aa:local:playlists');
  const item = c.tree()['aa:local:playlists'][0];
  await c.aa.handleAndroidAutoBrowse(item.mediaId);
  assert.equal(c.tree()[item.mediaId][0].mediaId, 'file:///music/local.flac');
  assert.equal(c.calls.filter(call => ['tracks', 'sign', 'url'].includes(call[0])).length, 0);
});
