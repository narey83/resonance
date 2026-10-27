const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');

function memoryFiles() {
  const files = new Map();
  const uri = parts => parts.map(part => typeof part === 'string' ? part : part.uri).join('/');
  class Directory {
    constructor(...parts) { this.uri = uri(parts); }
    create() {}
    get exists() { return true; }
    delete() { for (const key of files.keys()) if (key.startsWith(this.uri + '/')) files.delete(key); }
  }
  class File {
    constructor(...parts) { this.uri = uri(parts); }
    get exists() { return files.has(this.uri); }
    get size() { return this.exists ? files.get(this.uri).length : 0; }
    get parentDirectory() { return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
    textSync() { return files.get(this.uri); }
    write(value) { files.set(this.uri, value); }
  }
  return { files, File, Directory, Paths: { document: 'file:///documents' } };
}
const track = (path, bpm, key, extra = {}) => ({ path, bpm, key, genre: null, ...extra });

test('matching handles Camelot wraparound, relative keys and musical notation without inventing missing metadata', () => {
  const { camelot, compatibleKeys, suggestMixes } = mobileModules()('src/lib/mixSuggestions.ts');
  assert.equal(camelot('A minor'), '8A');
  assert.equal(camelot('F♯ minor'), '11A');
  assert.equal(camelot('C major'), '8B');
  assert.equal(compatibleKeys('12A', '1A'), true);
  assert.equal(compatibleKeys('8A', '8B'), true);
  assert.equal(compatibleKeys('8A', '9B'), false);
  assert.equal(compatibleKeys(null, null), false);
  const source = track('source', 128, 'Am');
  const results = suggestMixes(source, [source, track('good', 129, 'C'), track('bad', 160, 'F#'), track('unknown', null, null)]);
  assert.deepEqual(results.map(result => result.track.path), ['good']);
  assert.ok(results[0].reasons.includes('Compatible key · C'));
});

test('energy matches use analysed RMS summary and never substitute LUFS', () => {
  const { suggestMixes } = mobileModules()('src/lib/mixSuggestions.ts');
  const source = track('source', null, null, { djSummary: '{"energy":0.2}', lufs: -8 });
  const results = suggestMixes(source, [track('rms', null, null, { djSummary: '{"energy":0.21}' }), track('lufs-only', null, null, { lufs: -8 }), track('broken', null, null, { djSummary: 'bad' })]);
  assert.deepEqual(results.map(result => result.track.path), ['rms']);
});

function notesSetup(api) {
  const fs = memoryFiles();
  const load = mobileModules({ 'expo-file-system': fs, 'src/api/discovery.ts': api });
  const session = load('src/lib/sessionScope.ts'); session.resetSessionScope('alice');
  const store = load('src/store/discoveryStore.ts').useDiscoveryStore;
  return { load, session, store, fs };
}
const note = { path: '/music/song.mp3', role: 'opener', notes: 'Let the intro breathe', bookmarks: [{ id: 'cue', seconds: 42, label: 'Bass enters' }], revision: 0 };

test('offline notes survive rehydration then sync with the server revision', async () => {
  let online = false; let remote = [];
  const { store } = notesSetup({ saveNotes: async value => { if (!online) throw Error('Offline'); const saved = { ...value, revision: 1 }; remote = [saved]; return saved; }, getNotes: async () => remote, getWishes: async () => [] });
  await store.getState().save(note);
  assert.equal(store.getState().pending[note.path].notes, note.notes);
  store.setState({ notes: {}, pending: {} }); store.getState().hydrate();
  assert.equal(store.getState().notes[note.path].bookmarks[0].seconds, 42);
  online = true; await store.getState().sync();
  assert.equal(store.getState().notes[note.path].revision, 1);
  assert.deepEqual(store.getState().pending, {});
});

test('conflicts preserve phone text until the user explicitly chooses a version', async () => {
  const remote = { ...note, notes: 'Desktop edit', revision: 2 };
  const { store } = notesSetup({ saveNotes: async value => { if (value.revision !== 2) throw { isAxiosError: true, response: { status: 409 } }; return { ...value, revision: 3 }; }, getNotes: async () => [remote], getWishes: async () => [] });
  await store.getState().save(note);
  assert.equal(store.getState().notes[note.path].notes, note.notes);
  assert.equal(store.getState().conflicts[note.path].notes, 'Desktop edit');
  await store.getState().resolveConflict(note.path, false);
  assert.equal(store.getState().notes[note.path].notes, 'Desktop edit');
  assert.deepEqual(store.getState().pending, {});
});

test('an old note response cannot populate another account', async () => {
  const response = deferred();
  const { store, session } = notesSetup({ saveNotes: () => response.promise, getNotes: async () => [], getWishes: async () => [] });
  const saving = store.getState().save(note);
  session.resetSessionScope('bob'); response.resolve({ ...note, revision: 1 }); await saving;
  assert.deepEqual(store.getState().notes, {});
  assert.deepEqual(store.getState().pending, {});
});

test('wanted searches reuse durable searches and respect daily cooldown and batch limit', async () => {
  const restarted = [], created = [];
  const searches = [ { id: 'old', searchText: 'old wanted', startedAt: '2020-01-01', lastSearchedAt: null, isComplete: true }, { id: 'recent', searchText: 'recent wanted', startedAt: new Date().toISOString(), isComplete: true } ];
  const load = mobileModules({ 'src/api/searches.ts': { getAll: async () => searches, restart: async id => restarted.push(id), create: async (id, text) => created.push(text) } });
  const { refreshWantedSearches } = load('src/services/wantedSearches.ts');
  await refreshWantedSearches(['old wanted', 'recent wanted', 'new 1', 'new 2', 'new 3'].map(query => ({ query })));
  assert.deepEqual(restarted, ['old']); assert.deepEqual(created, ['new 1', 'new 2']);
});

test('offline crates keep original server identity, commit complete audio, and preserve a previous crate after a failed refresh', async () => {
  const fs = memoryFiles(); let fail = false; let requested;
  const load = mobileModules({
    'expo-file-system': fs,
    'expo-file-system/legacy': { createDownloadResumable: (url, destination, options) => { requested = { url, options }; return { downloadAsync: async () => { if (fail) return { status: 500 }; fs.files.set(destination, 'audio bytes'); return { status: 200 }; }, cancelAsync: async () => {} }; } },
    'src/api/client.ts': { getValidToken: async () => 'test-token' },
    'src/api/streamSignatures.ts': { ensureSigned: async () => {}, signedQuery: () => '&exp=123&sig=test-signature' },
    'src/store/auth.ts': { useAuthStore: { getState: () => ({ serverUrl: 'https://test.invalid' }) } },
    'src/lib/haptics.ts': { haptics: { skip: () => {} } },
  });
  load('src/lib/sessionScope.ts').resetSessionScope('alice');
  const { useOfflineCrates: store, offlineUriFor } = load('src/services/offlineCrates.ts');
  await store.getState().download('crate', 'Crate', [track('/music/track.flac', 128, 'Am')]);
  assert.equal(store.getState().crates[0].tracks[0].path, '/music/track.flac');
  const downloaded = offlineUriFor('/music/track.flac'); assert.ok(downloaded.endsWith('.flac'));
  assert.ok(requested.url.includes('&sig=test-signature'));
  assert.ok(!requested.url.includes('quality=')); assert.equal(requested.options.headers.Authorization, 'Bearer test-token');
  fail = true; await store.getState().download('crate', 'Crate', [track('/music/track.flac', 128, 'Am')]);
  assert.equal(offlineUriFor('/music/track.flac'), downloaded);
  assert.equal(store.getState().crates.length, 1);
  store.getState().remove('crate'); assert.equal(offlineUriFor('/music/track.flac'), undefined);
});
