// Exercise the production build with isolated API fixtures; no live account is used.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const build = path.resolve('build');
const screenshots = path.resolve('../branding-qa');
await mkdir(screenshots, { recursive: true });
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const prefix = url.pathname.startsWith('/resonance/');
  const pathname = prefix
    ? url.pathname.slice('/resonance'.length)
    : url.pathname;
  const file = path.resolve(build, '.' + pathname);
  if (!file.startsWith(build + path.sep) && file !== build) {
    response.writeHead(403).end();
    return;
  }

  try {
    const target = path.extname(file) ? file : path.join(build, 'index.html');
    let bytes = await readFile(target);
    if (target.endsWith('index.html') && prefix)
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            '<head>',
            '<head><script>window.urlBase="/resonance";</script>',
          ),
      );
    response
      .writeHead(200, {
        'Content-Type':
          types[path.extname(target)] || 'application/octet-stream',
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [theme, width, height, prefix] of [
    ['light', 1_440, 1_000, ''],
    ['amoled', 390, 844, ''],
    ['midnight', 1_440, 1_000, '/resonance'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(
      (value) => localStorage.setItem('resonance-theme', value),
      theme,
    );
    const page = await context.newPage();
    const errors = [];
    let submitted = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.includes('/api/v0/')) {
        if (url.pathname.endsWith('/session/initialized'))
          return route.fulfill({ json: true });
        if (
          route.request().method() === 'POST' &&
          url.pathname.endsWith('/session')
        ) {
          submitted += 1;
          return route.fulfill({
            status: 401,
            json: { message: 'Test sign-in rejected' },
          });
        }

        return route.fulfill({ json: {} });
      }

      return route.continue();
    });
    await page.goto(origin + prefix + '/');
    await page.locator('#login-username').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page
        .locator('.resonance-mark')
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    );
    assert.match(
      await page
        .locator('.auth-brand-title')
        .evaluate((el) => getComputedStyle(el).fontFamily),
      /Outfit/u,
    );
    assert.match(
      await page
        .locator('#login-username')
        .evaluate((el) => getComputedStyle(el).fontFamily),
      /Inter/u,
    );
    assert.ok(
      await page.evaluate(
        () =>
          document.fonts.check('600 28px Outfit') &&
          document.fonts.check('400 14px Inter'),
      ),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    for (const resource of [
      '/favicon.svg',
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/manifest.webmanifest',
    ]) {
      const result = await context.request.get(origin + prefix + resource);
      assert.equal(result.status(), 200);
    }

    await page.screenshot({
      path: path.join(screenshots, `login-${theme}-${width}.png`),
      fullPage: true,
    });
    await page.locator('#login-username').fill('branding-test');
    await page.locator('#login-password').fill('fixture-only');
    await page.locator('#login-password').press('Enter');
    await page.waitForFunction(
      () => !document.querySelector('.auth-submit')?.disabled,
    );
    assert.equal(submitted, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Render the actual authenticated shell with a test-only passthrough session.
  for (const width of [1_440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1_000 },
    });
    await context.addInitScript(() => {
      localStorage.setItem('resonance-token', 'n/a');
      localStorage.setItem('resonance-theme', 'midnight');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.includes('/hub'))
        return route.fulfill({ status: 503, body: '' });
      if (url.pathname.includes('/api/v0/')) {
        if (url.pathname.endsWith('/session/initialized'))
          return route.fulfill({ json: true });
        if (url.pathname.endsWith('/application'))
          return route.fulfill({
            json: { server: {}, shares: {}, version: {}, user: {} },
          });
        if (url.pathname.includes('/options'))
          return route.fulfill({ json: {} });
        return route.fulfill({ json: [] });
      }

      return route.continue();
    });
    await page.goto(origin + '/searches');
    const mark = page.locator('.status-brand .resonance-mark').first();
    await mark.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await mark.evaluate((image) => image.complete && image.naturalWidth > 0),
    );
    assert.equal(await mark.getAttribute('height'), '22');
    assert.match(
      await page
        .locator('.status-brand-name')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
      /Outfit/u,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(screenshots, `shell-midnight-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }

  console.log(
    'Branding browser checks passed: desktop/narrow sign-in and authenticated shell, local fonts, assets, keyboard submission and URL prefix.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => {
    server.close(resolve);
  });
}
