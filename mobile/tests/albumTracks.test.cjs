const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
const { albumTrackParams } = mobileModules()('src/lib/albumTracks.ts');

test('compilation arrivals retain the album filter when releases share a folder', () => {
  const params = albumTrackParams({ album: 'Faze #86: Dj Hell', artist: 'Various Artists', directory: '/music' });
  const library = [
    { album: 'Weekend Picks', title: 'High Energy', folder: '/music' },
    { album: 'Faze #86: Dj Hell', title: 'Selected album track', folder: '/music' },
  ];
  assert.deepEqual(library.filter(track => track.album === params.album && track.folder === params.folder).map(track => track.title), ['Selected album track']);
  assert.equal(params.artist, undefined);
  assert.equal(params.sort, 'track');
});

test('albums without a directory are scoped by album and artist', () => {
  assert.deepEqual(albumTrackParams({ album: 'Atlantis', artist: 'Sean Tyas + Peter Steele', directory: null }), {
    album: 'Atlantis', artist: 'Sean Tyas + Peter Steele', sort: 'track',
  });
});

test('album membership distinguishes artists, normalizes Unicode and rejects other releases', () => {
  const { belongsToAlbum } = mobileModules()('src/lib/albumTracks.ts');
  const album = { album: 'HYS007', artist: 'Uväll', albumArtist: 'Uväll' };
  assert.equal(belongsToAlbum({ album: 'HYS007', artist: 'Uva\u0308ll', albumArtist: null }, album), true);
  assert.equal(belongsToAlbum({ album: 'HYS007', artist: 'Brusca', albumArtist: null }, album), false);
  assert.equal(belongsToAlbum({ album: 'Another release', albumArtist: 'Uväll' }, album), false);
});
