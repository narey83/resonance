const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

const { messageCount, messageCountLabel } = mobileModules()('src/lib/messageCount.ts');

test('floating chat count combines private messages and room traffic', () => {
  assert.equal(messageCount(0, 0), 0);
  assert.equal(messageCount(2, 3), 5);
  assert.equal(messageCount(2, -1), 2);
  assert.equal(messageCount(Number.NaN, 1.9), 1);
});

test('message badges fit a compact bubble at large counts', () => {
  assert.equal(messageCountLabel(99), '99');
  assert.equal(messageCountLabel(100), '99+');
});
