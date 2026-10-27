// Native regression test: an Android Auto/browser client can recycle MusicService before JS
// initializes the player. Reusing that service used to crash with a duplicate media-session ID.
// Run against an emulator with the rebuilt development APK installed and Metro disconnected.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

const serial = process.env.ANDROID_SERIAL;
assert.match(serial ?? '', /^emulator-\d+$/, 'Set ANDROID_SERIAL to an emulator; this test stops the test app.');
const adbPath = process.env.ADB_PATH || 'adb';
const packageName = 'com.resonance.mobile';
const component = `${packageName}/com.doublesymmetry.trackplayer.service.MusicService`;

function adb(...args) {
  const result = spawnSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
  if (result.error) throw result.error;
  // Some Android shell versions return 255 for a successful stopservice command.
  const serviceStopped = args[2] === 'stopservice' && result.status === 255 &&
    /Service stopped/.test(result.stdout + result.stderr);
  assert.ok(result.status === 0 || serviceStopped, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /^Error:/m);
  return result.stdout;
}
function crashCount() {
  return (adb('logcat', '-d', '-b', 'crash', '-v', 'brief').match(/Process: com\.resonance\.mobile,/g) || []).length;
}

async function waitFor(check, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  assert.fail(message);
}

async function main() {
  const before = crashCount();
  adb('shell', 'am', 'force-stop', packageName);
  // Wait until the activity is foregrounded; Android rejects background service starts otherwise.
  adb('shell', 'am', 'start', '-W', '-n', `${packageName}/.MainActivity`);
  const results = [];
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    adb('shell', 'am', 'startservice', '-n', component);
    const pid = adb('shell', 'pidof', packageName).trim();
    assert.match(pid, /^\d+$/);
    assert.match(adb('shell', 'dumpsys', 'activity', 'services', packageName), /ServiceRecord\{[^\n]*MusicService/,
      'The playback service must be running before it is stopped.');
    adb('shell', 'am', 'stopservice', '-n', component);
    await waitFor(() => !/ServiceRecord\{[^\n]*MusicService/.test(
      adb('shell', 'dumpsys', 'activity', 'services', packageName)),
    'The service must actually be destroyed, so the next cycle recreates its media session.');
    assert.equal(adb('shell', 'pidof', packageName).trim(), pid, 'The app must survive service recycling.');
    assert.equal(crashCount(), before, 'The test must not produce a new native crash.');
    results.push({ cycle, serviceRecreated: true, appSurvived: true });
  }
  const report = { test: 'Android playback service lifecycle', serial, status: 'pass', results };
  if (process.env.SIM_TEST_REPORT) writeFileSync(process.env.SIM_TEST_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
