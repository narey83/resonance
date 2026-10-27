const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');

function setup({ remote = true, path = '/music/track.flac', offline = false, post } = {}) {
  let now = 1000;
  const calls = [];
  const load = mobileModules({
    'react-native-track-player': { getActiveTrack: async () => ({ _source: { path } }) },
    'src/api/client.ts': { apiClient: { post: async (...args) => { calls.push(args); if (post) await post(); } } },
    'src/lib/remoteAccess.ts': { remoteAccessEnabled: () => remote },
    'src/services/localMusicLibrary.ts': { isLocalPath: value => value?.startsWith('file:') },
    'src/services/offlineCrates.ts': { offlineUriFor: () => offline ? 'file:///offline' : null },
  }, { Date: { now: () => now } });
  return { report: load('src/services/playbackActivity.ts').reportPlaybackActivity, calls, advance: () => { now += 20000; } };
}

for (const platform of ['ios', 'android']) {
  test(`${platform}: reports buffered remote playback at most once per 20 seconds`, async () => {
    const { report, calls, advance } = setup();
    await report(); await report();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/musiclibrary/playback/activity');
    assert.equal(calls[0][1], null);
    advance(); await report(); assert.equal(calls.length, 2);
  });
}
for (const options of [{ remote: false }, { path: 'file:///local.mp3' }, { offline: true }, { path: null }]) {
  test(`does not contact a server for unavailable or local playback ${JSON.stringify(options)}`, async () => {
    const { report, calls } = setup(options); await report(); assert.equal(calls.length, 0);
  });
}
test('failures remain best effort and overlapping requests are suppressed', async () => {
  const gate = deferred();
  const { report, calls, advance } = setup({ post: () => gate.promise });
  const first = report(); await new Promise(setImmediate); advance(); await report();
  assert.equal(calls.length, 1); gate.reject(new Error('offline')); await first;
  advance(); await report(); assert.equal(calls.length, 2);
});
