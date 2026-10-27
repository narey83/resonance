const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
function setup(files = new Map()) {
  let failWrite = false;
  class File {
    constructor(_, name) { this.name = name; }
    get exists() { return files.has(this.name); }
    async text() { return files.get(this.name); }
    write(value) { if (failWrite) throw new Error('Storage full'); files.set(this.name, value); }
  }
  const load = mobileModules({
    'expo-file-system': { File, Paths: { document: { uri: 'file:///new/Documents/' } } },
    'src/api/client.ts': new Proxy({}, { get() { throw new Error('Local playlists must never access the server'); } }),
  });
  return { store: load('src/store/localPlaylistStore.ts').useLocalPlaylistStore, files, fail: () => { failWrite = true; } };
}
const track = path => ({ path, title: path, sig: 'server-signature', exp: 999, coverPath: 'https://server/artwork' });

test('device playlists persist independent metadata and order without a server session', async () => {
  const a = setup(), store = a.store.getState();
  const p = await store.create('  Device favourites  ');
  await Promise.all([store.addTracks(p.id, [track('file:///one.mp3')]), store.addTracks(p.id, [track('content://two')])]);
  await store.addTracks(p.id, [track('file:///one.mp3')]);
  await store.moveTrack(p.id, 'content://two', -1);
  await store.rename(p.id, 'My music');
  const restored = setup(a.files).store;
  await restored.getState().load();
  const saved = restored.getState().playlists[0];
  assert.equal(saved.name, 'My music');
  assert.deepEqual(saved.tracks.map(t => t.path), ['content://two', 'file:///one.mp3']);
  assert.equal(saved.tracks[0].sig, undefined);
  assert.equal(saved.tracks[0].coverPath, null);
  await restored.getState().removeTrack(p.id, 'content://two');
  assert.equal(restored.getState().playlists[0].tracks.length, 1);
  await restored.getState().remove(p.id);
  assert.equal(restored.getState().playlists.length, 0);
});

test('device playlists reject server identities and downloaded server tracks', async () => {
  const { store } = setup(); const p = await store.getState().create('Local');
  for (const t of [track('/server/one.mp3'), track('https://server/one.mp3'), { ...track('file:///download.mp3'), offlineUri: 'file:///download.mp3' }]) {
    await assert.rejects(store.getState().addTracks(p.id, [t]), /only local music/);
  }
  assert.equal(store.getState().playlists[0].tracks.length, 0);
});

test('a failed save keeps the previous playlist and later operations can recover', async () => {
  const a = setup(); const p = await a.store.getState().create('Kept'); a.fail();
  await assert.rejects(a.store.getState().rename(p.id, 'Not saved'), /Storage full/);
  assert.equal(a.store.getState().playlists[0].name, 'Kept');
  const restored = setup(a.files).store; await restored.getState().load();
  assert.equal(restored.getState().playlists[0].name, 'Kept');
  await restored.getState().rename(p.id, 'Recovered');
  assert.equal(restored.getState().playlists[0].name, 'Recovered');
});

test('unreadable storage is not silently overwritten', async () => {
  const { store, files } = setup(new Map([['local-playlists-v1.json', '{bad json']]));
  await assert.rejects(store.getState().create('New'));
  assert.equal(files.get('local-playlists-v1.json'), '{bad json');
});

test('imported audio paths follow an iOS app container relocation', async () => {
  const a = setup(); const p = await a.store.getState().create('Imported');
  await a.store.getState().addTracks(p.id, [track('file:///old/Documents/resonance-local-music/My%20song.mp3')]);
  assert.equal(a.store.getState().playlists[0].tracks[0].path, 'file:///new/Documents/resonance-local-music/My%20song.mp3');
  assert.equal(a.store.getState().playlists[0].tracks[0].directory, '/new/Documents/resonance-local-music');
});
