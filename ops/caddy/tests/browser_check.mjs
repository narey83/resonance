import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBrowserProbe, runMonitor } from '../frontend-health.mjs';

const require = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
);
const { chromium } = require('playwright');
const fixture = JSON.parse(process.env.HEALTH_BROWSER_FIXTURE);
const screenshots =
  process.env.HEALTH_SCREENSHOTS ||
  '/tmp/resonance-frontend-health-screenshots';
await mkdir(screenshots, { recursive: true });
const monitor = await runMonitor({
  chromium,
  origin: fixture.probeOrigin,
  port: fixture.healthPort,
  intervalMs: 300,
  timeoutMs: 10_000,
});
const browser = await chromium.launch({ chromiumSandbox: true });
const probe = createBrowserProbe({
  chromium,
  origin: fixture.probeOrigin,
  timeoutMs: 5000,
});
const waitStatus = async (expected) => {
  const until = Date.now() + 55_000;
  while (Date.now() < until) {
    const response = await fetch(`${fixture.origin}/__site/status`);
    if (response.status === expected) return response;
    await delay(250);
  }
  throw new Error(
    `Caddy never reached ${expected}: ${JSON.stringify(monitor.state.snapshot())}`,
  );
};
const mode = async (session) => {
  await writeFile(
    `${fixture.mode}.next`,
    JSON.stringify({ state: 'available', status: 200, session }),
  );
  await rename(`${fixture.mode}.next`, fixture.mode);
};
const index = await readFile(path.join(fixture.web, 'index.html'), 'utf8');
const script = index.match(/src="([^"]*static\/js\/main\.[^"]+\.js)"/u)?.[1];
assert.ok(script, 'Production HTML must reference the actual main bundle');
const main = path.join(fixture.web, script.replace(/^\.?\//u, ''));
const original = await readFile(main);
try {
  await waitStatus(200);
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    return [fixture.origin, fixture.probeOrigin].includes(origin)
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/library?keep=health-check`);
  await page.locator('#login-username').waitFor();
  await page.locator('#login-username').fill('read-only-health-check');
  await page.locator('#login-username').fill('');
  await page.evaluate(() =>
    localStorage.setItem('health-retained-state', 'keep'),
  );
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: path.join(screenshots, `healthy-${name}.png`),
    });
  }
  console.log('PASS: real built app renders and login controls respond');

  await rename(main, `${main}.held`);
  try {
    await waitStatus(503);
    assert.equal(
      (await fetch(`${fixture.probeOrigin}/health/ready`)).status,
      200,
    );
    assert.equal(
      (await fetch(`${fixture.origin}/api/v0/session/initialized`)).status,
      200,
    );
    await page.reload();
    await page
      .getByRole('heading', { name: 'The web app is being restored' })
      .waitFor();
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 900 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: path.join(screenshots, `unavailable-${name}.png`),
      });
    }
    console.log(
      'PASS: missing JavaScript closes web access while backend stays healthy',
    );
  } finally {
    await rename(`${main}.held`, main);
  }
  await waitStatus(200);
  await page.locator('#login-username').waitFor({ timeout: 20_000 });
  assert.ok(page.url().endsWith('/library?keep=health-check'));
  assert.equal(
    await page.evaluate(() => localStorage.getItem('health-retained-state')),
    'keep',
  );
  console.log(
    'PASS: independent status page recovers to original route and retains storage',
  );

  await mode('hang');
  try {
    await waitStatus(503);
    assert.equal(
      (await fetch(`${fixture.probeOrigin}/health/ready`)).status,
      200,
    );
    console.log(
      'PASS: a hung real initialization API is detected despite backend readiness',
    );
  } finally {
    await mode('normal');
  }
  await waitStatus(200);

  await mode('setup');
  assert.deepEqual(await probe.check(), { ok: true, code: 'ready' });
  await mode('normal');
  console.log('PASS: first-time setup remains a healthy frontend');

  // Exercise the actual production boundary without changing any application data.
  const crashed = await context.newPage();
  await crashed.addInitScript(() => {
    const remove = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function (...tokens) {
      if (this === document.documentElement.classList)
        throw new Error('Synthetic render failure');
      return remove.apply(this, tokens);
    };
  });
  await crashed.goto(fixture.probeOrigin);
  await crashed.getByRole('alert').waitFor();
  assert.equal(
    await crashed.evaluate(
      () => document.documentElement.dataset.resonanceFrontend,
    ),
    'failed',
  );
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    await crashed.setViewportSize(viewport);
    await crashed.screenshot({
      path: path.join(screenshots, `render-error-${name}.png`),
    });
  }
  await crashed.close();
  console.log(
    'PASS: React crashes render an actionable recovery screen and revoke readiness',
  );

  await writeFile(
    main,
    Buffer.concat([
      original,
      Buffer.from('\nthrow new Error("synthetic-boot-failure");'),
    ]),
  );
  try {
    assert.equal((await probe.check()).ok, false);
  } finally {
    await writeFile(main, original);
  }
  console.log(
    'PASS: executable JavaScript returning HTTP 200 can still fail the browser probe',
  );

  await writeFile(
    main,
    Buffer.concat([original, Buffer.from('\nwhile(true){}')]),
  );
  try {
    const result = await probe.check();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'render-timeout');
  } finally {
    await writeFile(main, original);
  }
  assert.equal((await probe.check()).ok, true);
  console.log(
    'PASS: an unresponsive browser renderer times out, is stopped, and can recover',
  );
  await page.close();
} finally {
  await mode('normal');
  await writeFile(main, original);
  await probe.close();
  await monitor.close();
  await browser.close();
}
