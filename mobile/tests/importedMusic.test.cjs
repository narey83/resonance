const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

function setup(names, canceled = false) {
  const files = new Map(names.map(name => [`source/${name}`, name]));
  class Directory {
    constructor(parent, name) { this.uri = `${parent.uri ?? parent}/${name}`; }
    create() {}
    list() { return [...files.keys()].filter(key => key.startsWith(`${this.uri}/`)).map(key => new File(key)); }
  }
  class File {
    constructor(parent, name) { this.uri = name ? `${parent.uri}/${name}` : parent; }
    get name() { return this.uri.split('/').pop(); }
    get exists() { return files.has(this.uri); }
    copy(target) { files.set(target.uri, files.get(this.uri)); }
    delete() { files.delete(this.uri); }
    static async pickFileAsync() { return { canceled, result: names.map(name => new File(`source/${name}`)) }; }
  }
  const service = mobileModules({ 'expo-file-system': { File, Directory, Paths: { document: 'documents' } } })('src/services/importedMusic.ts');
  return { service, files };
}

test('imports permanent audio copies and preserves originals and duplicate names', async () => {
  const { service, files } = setup(['song.mp3', 'notes.txt']);
  assert.equal(await service.importAudioFiles(), 1);
  assert.equal(await service.importAudioFiles(), 1);
  assert.deepEqual(service.importedMusicFiles().map(file => file.name), ['song.mp3', 'song (2).mp3']);
  assert.equal(files.get('source/song.mp3'), 'song.mp3');
});

test('canceling the native picker leaves local music unchanged', async () => {
  const { service } = setup(['song.mp3'], true);
  assert.equal(await service.importAudioFiles(), 0);
  assert.deepEqual(service.importedMusicFiles(), []);
});
