const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');
for (const platform of ['ios', 'android']) {
  test(`${platform} starts one shared native setup with platform-appropriate buffers`, async () => {
    const gate = deferred(), calls = [];
    const native = {
      setupPlayer: options => { calls.push(['setup', options]); return gate.promise; },
      updateOptions: async options => calls.push(['options', options]),
      AppKilledPlaybackBehavior: { ContinuePlayback: 1 },
      Capability: { Play: 'play', Pause: 'pause', SeekTo: 'seek' },
    };
    const load = mobileModules({ 'react-native': { Platform: { OS: platform } }, 'react-native-track-player': native });
    const { ensurePlayerSetup } = load('src/services/playerSetup.ts');
    const first = ensurePlayerSetup(), second = ensurePlayerSetup();
    assert.equal(first, second);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].minBuffer, platform === 'ios' ? 5 : 30);
    assert.equal(calls[0][1].playBuffer, platform === 'android' ? 0.5 : 1);
    assert.equal(calls[0][1].maxBuffer, 120);
    assert.equal(calls[0][1].backBuffer, 30);
    assert.ok(calls[0][1].playBuffer > 0 && calls[0][1].playBuffer < calls[0][1].minBuffer);
    gate.resolve(); await Promise.all([first, second]);
    assert.equal(calls.length, 2);
    assert.ok(calls[1][1].capabilities.includes('play'));
    assert.ok(calls[1][1].notificationCapabilities.includes('seek'));
  });
}
