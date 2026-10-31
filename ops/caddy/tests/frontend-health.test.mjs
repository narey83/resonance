import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  createBrowserProbe,
  deadline,
  HealthState,
  healthServer,
  probeAddress,
} from '../frontend-health.mjs';

test('late browser launches are killed after timeout and inherit no secret environment', async () => {
  let killed = 0;
  let connected = false;
  let options;
  process.env.RESONANCE_SYNTHETIC_SECRET = 'must-not-reach-browser';
  const probe = createBrowserProbe({
    origin: 'http://127.0.0.1:8092',
    timeoutMs: 10,
    chromium: {
      launchServer: async (value) => {
        options = value;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          kill: async () => {
            killed++;
          },
        };
      },
      connect: async () => {
        connected = true;
      },
    },
  });
  try {
    assert.deepEqual(await probe.check(), {
      ok: false,
      code: 'render-timeout',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(killed, 1);
    assert.equal(connected, false);
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.chromiumSandbox, true);
    assert.equal(options.env.RESONANCE_SYNTHETIC_SECRET, undefined);
  } finally {
    delete process.env.RESONANCE_SYNTHETIC_SECRET;
    await probe.close();
  }
});

test('requires two successes to open, two failures to close, and fresh results', () => {
  let now = 0;
  const health = new HealthState({ now: () => now, maxAgeMs: 100 });
  assert.equal(health.snapshot().ready, false);
  health.complete({ ok: true, code: 'ready' });
  assert.equal(health.snapshot().ready, false);
  health.complete({ ok: true, code: 'ready' });
  assert.equal(health.snapshot().ready, true);
  health.complete({ ok: false, code: 'render-failed' });
  assert.equal(health.snapshot().ready, true);
  health.complete({ ok: false, code: 'render-failed' });
  assert.equal(health.snapshot().ready, false);
  health.complete({ ok: true, code: 'ready' });
  assert.equal(health.snapshot().ready, false);
  health.complete({ ok: true, code: 'ready' });
  now = 101;
  assert.deepEqual(health.snapshot(), { ready: false, code: 'probe-stale' });
  health.complete({ ok: true, code: 'ready' });
  assert.equal(health.snapshot().ready, false);
  health.complete({ ok: true, code: 'ready' });
  assert.equal(health.snapshot().ready, true);
});

test('probe origins cannot send a browser to a remote host or carry credentials', () => {
  assert.equal(probeAddress('http://127.0.0.1:8092'), 'http://127.0.0.1:8092');
  assert.equal(probeAddress('http://[::1]:8092/'), 'http://[::1]:8092');
  for (const value of [
    'https://127.0.0.1/',
    'http://example.com/',
    'http://user:secret@127.0.0.1/',
    'http://127.0.0.1/?token=secret',
    'http://127.0.0.1/#secret',
    'http://127.0.0.1/api/',
  ]) {
    assert.throws(() => probeAddress(value));
  }
});

test('a hung operation has a bounded deadline', async () => {
  await assert.rejects(deadline(new Promise(() => {}), 10), {
    code: 'render-timeout',
  });
  assert.equal(await deadline(Promise.resolve('ready'), 10), 'ready');
});

test('read-only health endpoint fails closed until ready and after stale results', async () => {
  let now = 0;
  const state = new HealthState({ now: () => now, maxAgeMs: 100 });
  const server = healthServer(state);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${origin}/health/ready`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    state.complete({ ok: true, code: 'ready' });
    state.complete({ ok: true, code: 'ready' });
    response = await fetch(`${origin}/health/ready`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-resonance-frontend-state'), 'ready');
    assert.deepEqual(await response.json(), { ready: true, code: 'ready' });
    assert.equal(
      (await fetch(`${origin}/health/ready`, { method: 'HEAD' })).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/health/ready`, { method: 'POST' })).status,
      405,
    );
    assert.equal((await fetch(`${origin}/other`)).status, 404);
    now = 101;
    assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
