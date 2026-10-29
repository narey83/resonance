const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
const { isRecentlyIndexed } = mobileModules()('src/lib/recentLibraryItems.ts');
const now = Date.UTC(2026, 9, 29, 12);
const ticksAt = (time) => 621_355_968_000_000_000 + time * 10_000;
const week = 7 * 86_400_000;

test('new tracks share the web seven-day window', () => {
  assert.equal(isRecentlyIndexed(ticksAt(now), now), true);
  assert.equal(isRecentlyIndexed(ticksAt(now - week + 1000), now), true);
  assert.equal(isRecentlyIndexed(ticksAt(now - week), now), false);
  assert.equal(isRecentlyIndexed(ticksAt(now - week - 1000), now), false);
});

test('missing, invalid and future index dates never mark a track new', () => {
  for (const ticks of [undefined, null, 0, NaN, Infinity, ticksAt(now + 1000)])
    assert.equal(isRecentlyIndexed(ticks, now), false);
});
