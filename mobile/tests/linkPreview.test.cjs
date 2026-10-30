const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules, deferred, tick } = require('./helpers.cjs');
function setup() {
  const requests = [], images = [];
  let now = 0;
  const load = mobileModules({
    'src/api/client.ts': { apiClient: { get: (_, { params }) => {
      const gate = deferred(); requests.push({ url: params.url, ...gate }); return gate.promise;
    } } },
    'react-native': { Image: { prefetch: async url => { images.push(url); } } },
  }, { Date: { now: () => now } });
  return { api: load('src/api/linkPreview.ts'), scope: load('src/lib/sessionScope.ts'), requests, images, advance: ms => { now += ms; } };
}
test('background previews deduplicate links, bound concurrency and are synchronously available before a card opens', async () => {
  const { api, requests, images } = setup();
  const url = 'https://example.com/music';
  api.prefetchMessagePreviews([{ message: url }, { message: `See ${url}.` }, { message: 'https://example.com/second' }, { message: 'https://example.com/third' }]);
  await tick();
  assert.equal(requests.length, 2);
  requests[0].resolve({ data: { url: requests[0].url, title: 'Ready title', imageUrl: 'https://example.com/image.jpg' } });
  requests[1].resolve({ data: { url: requests[1].url, title: 'Other title', imageUrl: null } });
  await tick();
  assert.equal(requests.length, 3);
  requests[2].resolve({ data: { url, title: 'Music ready', imageUrl: null } });
  await tick();
  assert.equal(api.peekLinkPreview(url).title, 'Music ready');
  assert.equal((await api.getLinkPreview(url)).title, 'Music ready');
  assert.equal(requests.length, 3);
  assert.deepEqual(images, ['https://example.com/image.jpg']);
});
test('failed previews retry after cooldown and old-account responses cannot repopulate cache', async () => {
  const { api, requests, scope, images, advance } = setup();
  const url = 'https://example.com/retry';
  let result = api.getLinkPreview(url);
  await tick(); requests[0].reject(new Error('offline')); await result;
  assert.equal(await api.getLinkPreview(url), null);
  assert.equal(requests.length, 1);
  advance(30_001);
  result = api.getLinkPreview(url);
  await tick();
  scope.resetSessionScope('another-account');
  requests[1].resolve({ data: { url, title: 'Old account', imageUrl: 'https://example.com/private.jpg' } });
  assert.equal(await result, null);
  assert.equal(api.peekLinkPreview(url), null);
  assert.deepEqual(images, []);
});
