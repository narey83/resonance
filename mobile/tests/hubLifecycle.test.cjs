const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred } = require('./helpers.cjs');

function setup() {
  const load = mobileModules();
  const session = load('src/lib/sessionScope.ts'); session.resetSessionScope('alice');
  const lifecycle = load('src/lib/hubLifecycle.ts');
  const logger = lifecycle.createHubLogger('test');
  let stops = 0;
  const hub = { stop: async () => { stops++; logger.log(4, 'The connection was stopped during negotiation.'); } };
  lifecycle.trackHubConnection(hub, logger);
  return { load, session, lifecycle, logger, hub, stops: () => stops };
}

test('intentional stop cancels the hub without reporting cancellation as an application error', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const app = setup();
  await app.lifecycle.stopHubConnection(app.hub);
  assert.equal(app.stops(), 1);
  assert.equal(errors.mock.callCount(), 0);
  app.session.resetSessionScope('bob');
  assert.equal(app.stops(), 1, 'disposed hubs unregister their session listener');
});

test('changing accounts stops the previous login connection immediately', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const app = setup();
  app.session.resetSessionScope('bob');
  assert.equal(app.stops(), 1);
  app.logger.log(4, 'Old negotiation returned 401');
  assert.equal(errors.mock.callCount(), 0);
});

test('genuine errors from active connections remain visible', t => {
  const errors = t.mock.method(console, 'error', () => {});
  const app = setup();
  app.logger.log(4, 'Server returned 401');
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], /connection:test.*Server returned 401/);
});

test('teardown does not wait for an unfinished negotiation before requesting cancellation', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const app = setup();
  const pending = deferred();
  app.hub.stop = () => { app.logger.log(4, 'The connection was stopped during negotiation.'); return pending.promise; };
  const stopping = app.lifecycle.stopHubConnection(app.hub);
  app.logger.log(4, 'Late WebSocket failure');
  assert.equal(errors.mock.callCount(), 0);
  pending.resolve(); await stopping;
});
