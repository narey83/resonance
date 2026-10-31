import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
);
const { chromium } = require('playwright');
const fixture = JSON.parse(process.env.HTTP3_RESUMPTION_FIXTURE);
const origin = new URL(fixture.origin);
const adminOrigin = 'http://' + fixture.admin;
const getConfig = async () => {
  const response = await fetch(adminOrigin + '/config/', {
    headers: { Origin: adminOrigin },
  });
  assert.equal(response.status, 200);
  return response.json();
};
const configure = async (config) => {
  const response = await fetch(adminOrigin + '/load', {
    method: 'POST',
    headers: {
      Origin: adminOrigin,
      'Content-Type': 'application/json',
      'Cache-Control': 'must-revalidate',
    },
    body: JSON.stringify(config),
  });
  assert.equal(response.status, 200);
};
const config = await getConfig();
const server = Object.values(config.apps.http.servers).find((value) =>
  value.listen.some((address) => address.endsWith(':' + origin.port)),
);
assert.ok(server);
assert.equal(
  server.allow_0rtt,
  false,
  'The deployed transport import must disable early data',
);
assert.equal(
  server.max_header_bytes,
  16384,
  'The deployed header budget must be explicit',
);
assert.ok(server.protocols.includes('h3'));
// A TCP fallback must not hide a failed QUIC connection in this regression test.
server.protocols = ['h3'];
server.max_header_bytes = 1048576;
await configure(config);

const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  args: [
    `--origin-to-force-quic-on=${origin.host}`,
    '--host-resolver-rules=MAP localhost 127.0.0.1',
    // Trust only the generated loopback test certificate, not arbitrary certs.
    `--ignore-certificate-errors-spki-list=${fixture.pin}`,
    `--log-net-log=${fixture.netlog}`,
  ],
});
const responses = [];
const errors = [];
const startup = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.url.includes('/api/test-audio')) responses.push(response);
  });
  cdp.on('Network.loadingFailed', ({ errorText }) => {
    if (errorText !== 'net::ERR_ABORTED') errors.push(errorText);
  });
  const navigation = await page.goto(fixture.origin + '/__site/live');
  assert.equal(navigation.status(), 200);
  await page.setContent('<button>Play</button><audio preload="none"></audio>');
  for (let index = 0; index < 8; index++) {
    if (index === 4) {
      // Mirror the 2.11.4 -> 2.11.7 default change with the same browser and
      // session cache. Early data previously caused QUIC error 164/165 here.
      server.max_header_bytes = 16384;
      await configure(config);
    }
    await page.evaluate((index) => {
      const audio = document.querySelector('audio');
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      document.querySelector('button').onclick = () => {
        window.startupMs = null;
        const start = performance.now();
        audio.addEventListener(
          'playing',
          () => {
            window.startupMs = performance.now() - start;
          },
          { once: true },
        );
        audio.src = '/api/test-audio?track=' + index;
        void audio.play();
      };
    }, index);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(
      () => document.querySelector('audio').currentTime > 0.02,
      null,
      { timeout: 5000 },
    );
    startup.push(await page.evaluate(() => window.startupMs));
    await page.evaluate(() => {
      document.querySelector('audio').currentTime = 4;
    });
    await page.waitForFunction(
      () =>
        document.querySelector('audio').readyState >= 3 &&
        document.querySelector('audio').currentTime >= 4,
      null,
      { timeout: 5000 },
    );
  }
  const range = await page.evaluate(async () => {
    document.querySelector('audio').pause();
    const response = await fetch('/api/test-audio?range=check', {
      headers: { Range: 'bytes=100-199' },
    });
    return {
      status: response.status,
      bytes: (await response.arrayBuffer()).byteLength,
    };
  });
  assert.deepEqual(range, { status: 206, bytes: 100 });
  assert.ok(responses.length >= 9);
  assert.ok(
    responses.every((response) => response.protocol === 'h3'),
    'No hidden HTTP2 fallback',
  );
  assert.ok(
    new Set(responses.map((response) => response.connectionId)).size >= 2,
    'Must test a new QUIC connection after reload',
  );
  assert.deepEqual(errors, []);
  assert.ok(startup.every((ms) => ms !== null && ms < 2000));
  await context.close();
} finally {
  await browser.close();
}
const log = JSON.parse(await readFile(fixture.netlog, 'utf8'));
const mismatch = log.events.filter((event) =>
  [164, 165].includes(event.params?.quic_error),
);
assert.deepEqual(
  mismatch,
  [],
  'No resumed-settings mismatch in the actual browser NetLog',
);
console.log(
  JSON.stringify({
    protocol: 'h3',
    tracks: startup.length,
    startupMs: startup,
    headerLimitChange: '1048576 -> 16384',
    earlyData: false,
    settingsMismatches: 0,
    seeking: true,
    ranges: true,
    reconnect: true,
  }),
);
