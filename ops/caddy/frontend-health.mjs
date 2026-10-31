// A bounded, credential-free browser check, independent of the application.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  new URL('../../frontend/package.json', import.meta.url),
);

export const probeAddress = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'The frontend probe must use a credential-free loopback HTTP origin',
    );
  }
  return url.origin;
};

export class HealthState {
  constructor({
    now = () => performance.now(),
    maxAgeMs = 60_000,
    threshold = 2,
  } = {}) {
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.threshold = threshold;
    this.ready = false;
    this.successes = 0;
    this.failures = 0;
    this.checkedAt = null;
    this.code = 'starting';
  }

  complete({ ok, code }) {
    if (
      this.checkedAt !== null &&
      this.now() - this.checkedAt > this.maxAgeMs
    ) {
      this.ready = false;
      this.successes = 0;
    }
    this.checkedAt = this.now();
    this.code = code;
    this.successes = ok ? this.successes + 1 : 0;
    this.failures = ok ? 0 : this.failures + 1;
    if (this.successes >= this.threshold) this.ready = true;
    if (this.failures >= this.threshold) this.ready = false;
  }

  snapshot() {
    const stale =
      this.checkedAt === null || this.now() - this.checkedAt > this.maxAgeMs;
    return {
      ready: this.ready && !stale,
      code: stale ? 'probe-stale' : this.code,
    };
  }
}

export const deadline = async (operation, timeoutMs) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('Probe timed out'), {
                code: 'render-timeout',
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const createBrowserProbe = ({
  chromium,
  origin,
  timeoutMs = 20_000,
}) => {
  const target = probeAddress(origin);
  let browserServer;
  let browser;
  let cancelCurrent = () => {};

  const closeBrowser = async () => {
    const owned = browserServer;
    browser = null;
    browserServer = null;
    if (owned) await owned.kill();
  };
  const close = async () => {
    cancelCurrent();
    await closeBrowser();
  };

  const check = async () => {
    let context;
    let assetFailed = false;
    let runtimeFailed = false;
    let cancelled = false;
    cancelCurrent = () => {
      cancelled = true;
    };
    try {
      await deadline(
        (async () => {
          if (!browser?.isConnected()) {
            await closeBrowser();
            const env = Object.fromEntries(
              [
                'PATH',
                'HOME',
                'TMPDIR',
                'LANG',
                'LC_ALL',
                'TZ',
                'XDG_RUNTIME_DIR',
              ]
                .filter((key) => process.env[key] !== undefined)
                .map((key) => [key, process.env[key]]),
            );
            const launched = await chromium.launchServer({
              host: '127.0.0.1',
              headless: true,
              chromiumSandbox: true,
              timeout: timeoutMs,
              env,
            });
            if (cancelled) {
              await launched.kill();
              throw new Error('Probe cancelled');
            }
            browserServer = launched;
            const connected = await chromium.connect(launched.wsEndpoint(), {
              timeout: timeoutMs,
            });
            if (cancelled) throw new Error('Probe cancelled');
            browser = connected;
          }
          context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            serviceWorkers: 'block',
          });
          // Optional external services (e.g. Cast) must not decide core readiness.
          await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            return url.origin === target ? route.continue() : route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', (error) => {
            if (!error.message.includes('ResizeObserver loop'))
              runtimeFailed = true;
          });
          page.on('requestfailed', (request) => {
            if (
              new URL(request.url()).origin === target &&
              ['script', 'stylesheet'].includes(request.resourceType())
            )
              assetFailed = true;
          });
          page.on('response', (response) => {
            const type = response.request().resourceType();
            if (
              new URL(response.url()).origin !== target ||
              !['script', 'stylesheet'].includes(type)
            )
              return;
            const mime = response.headers()['content-type'] || '';
            if (
              response.status() !== 200 ||
              (type === 'stylesheet'
                ? !mime.includes('text/css')
                : !/(java|ecma)script/u.test(mime))
            )
              assetFailed = true;
          });
          const response = await page.goto(target, {
            waitUntil: 'domcontentloaded',
            timeout: timeoutMs,
          });
          if (response?.status() !== 200)
            throw Object.assign(new Error('Navigation failed'), {
              code: 'navigation-failed',
            });
          await page.waitForFunction(
            () =>
              ['ready', 'failed'].includes(
                document.documentElement.dataset.resonanceFrontend,
              ),
            null,
            { timeout: timeoutMs },
          );
          // Require rendered content and a working event loop after initialization.
          await page.waitForFunction(
            () => {
              const root = document.querySelector('#root');
              return (
                document.documentElement.dataset.resonanceFrontend ===
                  'failed' ||
                (root?.textContent.trim() &&
                  root.getBoundingClientRect().height > 0)
              );
            },
            null,
            { timeout: timeoutMs },
          );
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          // Exercise the login control without submitting credentials or changing data.
          const username = page.locator('#login-username');
          if (await username.count()) {
            await username.fill('frontend-health-check', { timeout: 2000 });
            await username.fill('', { timeout: 2000 });
          }
          const state = await page.evaluate(
            () => document.documentElement.dataset.resonanceFrontend,
          );
          if (state !== 'ready' || runtimeFailed)
            throw Object.assign(new Error('Render failed'), {
              code: 'render-failed',
            });
          if (assetFailed)
            throw Object.assign(new Error('Asset failed'), {
              code: 'asset-failed',
            });
        })(),
        timeoutMs,
      );
      return { ok: true, code: 'ready' };
    } catch (error) {
      cancelled = true;
      // Publish fixed reason codes only, never console text, URLs or session data.
      const code = assetFailed
        ? 'asset-failed'
        : [
              'navigation-failed',
              'render-failed',
              'asset-failed',
              'render-timeout',
            ].includes(error.code)
          ? error.code
          : 'browser-error';
      await closeBrowser();
      return { ok: false, code };
    } finally {
      if (context && browser) {
        try {
          await deadline(context.close(), 2000);
        } catch {
          await close();
        }
      }
    }
  };
  return { check, close };
};

export const healthServer = (state) =>
  createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (request.url !== '/health/ready') {
      response.writeHead(404).end();
      return;
    }
    const result = state.snapshot();
    response.writeHead(result.ready ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Resonance-Frontend-State': result.ready ? 'ready' : 'unavailable',
      ...(result.ready ? {} : { 'Retry-After': '5' }),
    });
    response.end(
      request.method === 'HEAD' ? undefined : JSON.stringify(result),
    );
  });

export const runMonitor = async ({
  origin,
  port = 8091,
  intervalMs = 15_000,
  timeoutMs = 20_000,
  chromium,
} = {}) => {
  probeAddress(origin);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid monitor port');
  const state = new HealthState({
    maxAgeMs: 2 * (intervalMs + timeoutMs) + 5000,
  });
  const probe = createBrowserProbe({ chromium, origin, timeoutMs });
  const server = healthServer(state);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let stopped = false;
  let timer;
  const tick = async () => {
    const result = await probe.check();
    if (stopped) return;
    const before = state.snapshot().ready;
    state.complete(result);
    if (before !== state.snapshot().ready)
      console.log(
        JSON.stringify({ event: 'frontend-health', ...state.snapshot() }),
      );
    timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return {
    server,
    state,
    close: async () => {
      stopped = true;
      clearTimeout(timer);
      await probe.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { chromium } = require('playwright');
  const monitor = await runMonitor({
    origin:
      process.env.RESONANCE_FRONTEND_PROBE_ORIGIN || 'http://127.0.0.1:8092',
    port: Number(process.env.RESONANCE_FRONTEND_HEALTH_PORT || 8091),
    chromium,
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => void monitor.close());
}
