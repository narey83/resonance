import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
);
const { chromium } = require('playwright');
const { origin, admin } = JSON.parse(process.env.MEDIA_TRANSPORT_FIXTURE);
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  // Keep this existing test as the strict TCP/HTTP2 fallback check.
  args: ['--disable-quic'],
});
try {
  // Trust is relaxed only for this disposable loopback fixture's one-day cert.
  // The deployed site's certificate and browser protections remain unchanged.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const responses = [];
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.url.includes('/api/test-audio')) responses.push(response);
  });
  await page.goto(origin + '/__site/live');
  await page.setContent('<button>Play</button><audio preload="none"></audio>');
  const results = [];
  for (let index = 0; index < 8; index++) {
    if (index === 4) {
      // Keep the browser open and reuse it after the same gateway reload that
      // happens during deployment. Do not hide recovery behind a new context.
      const adminOrigin = 'http://' + admin;
      const configResponse = await fetch(adminOrigin + '/config/', {
        headers: { Origin: adminOrigin },
      });
      assert.equal(
        configResponse.status,
        200,
        await configResponse.clone().text(),
      );
      const reload = await fetch('http://' + admin + '/load', {
        method: 'POST',
        headers: {
          Origin: adminOrigin,
          'Content-Type': 'application/json',
          'Cache-Control': 'must-revalidate',
        },
        body: await configResponse.text(),
      });
      assert.equal(reload.status, 200);
    }
    await page.evaluate((index) => {
      const audio = document.querySelector('audio');
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      document.querySelector('button').onclick = () => {
        window.started = performance.now();
        window.startedPlaying = null;
        audio.addEventListener(
          'playing',
          () => {
            window.startedPlaying = performance.now() - window.started;
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
    results.push(await page.evaluate(() => window.startedPlaying));
    await page.evaluate(() => {
      document.querySelector('audio').currentTime = 4;
    });
    await page.waitForFunction(
      () =>
        document.querySelector('audio').currentTime >= 4 &&
        document.querySelector('audio').readyState >= 3,
      null,
      { timeout: 5000 },
    );
  }
  // Also interrupt in-flight loads, as users do when skipping quickly.
  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    for (let index = 0; index < 8; index++) {
      audio.src = '/api/test-audio?cancel=' + index;
      audio.load();
    }
    audio.src = '/api/test-audio?final=true';
    void audio.play();
  });
  await page.waitForFunction(
    () => document.querySelector('audio').currentTime > 0.02,
    null,
    { timeout: 5000 },
  );
  const rangeResponse = await page.request.get(origin + '/api/test-audio', {
    headers: { Range: 'bytes=100-199' },
  });
  assert.equal(rangeResponse.status(), 206);
  assert.equal((await rangeResponse.body()).length, 100);
  assert.ok(
    rangeResponse
      .headers()
      ['alt-svc'].includes(`h3=":${new URL(origin).port}"`),
  );
  assert.ok(responses.length >= 9);
  assert.ok(responses.every((response) => response.protocol === 'h2'));
  assert.ok(results.every((ms) => ms !== null && ms < 2000));
  await page.evaluate(() => document.querySelector('audio').pause());
  console.log(
    JSON.stringify({
      tracks: results.length,
      playingMs: results,
      protocol: 'h2',
      ranges: true,
      seeking: true,
      reloadRecovery: true,
      rapidSkipRecovery: true,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
