const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
const { usableFold, occludingFold } = mobileModules({ react: {}, 'react-native': {} })('src/lib/adaptiveWindow.ts');
test('physical hinge keeps its occluded width between two usable panes', () => {
  const hinge = { x: 540, y: 0, width: 34, height: 720, vertical: true };
  assert.deepEqual(usableFold(hinge, 1114, 720), hinge);
});
test('tabletop fold can separate top artwork from bottom controls without an occluded gap', () => {
  const fold = { x: 0, y: 400, width: 700, height: 0, vertical: false };
  assert.deepEqual(usableFold(fold, 700, 800), fold);
});
test('rotation and folding back to the cover screen discard stale hinge geometry', () => {
  const hinge = { x: 540, y: 0, width: 34, height: 720, vertical: true };
  assert.equal(usableFold(hinge, 360, 720), null);
  assert.equal(usableFold(hinge, 720, 1114), null);
  assert.equal(usableFold(null, 360, 720), null);
});
test('invalid and edge-only features cannot hide the app in a zero-width pane', () => {
  for (const x of [0, -1, NaN, Infinity, 100]) {
    assert.equal(usableFold({ x, y: 0, width: 0, height: 720, vertical: true }, 800, 720), null);
  }
});

test('a tabletop crease must not confine library navigation to half the screen', () => {
  const tabletop = { x: 0, y: 400, width: 700, height: 0, vertical: false };
  assert.equal(usableFold(tabletop, 700, 800), tabletop);
  assert.equal(occludingFold(tabletop), null);
  assert.equal(occludingFold({ x: 400, y: 0, width: 0, height: 700, vertical: true }), null);
});
test('physical dual-screen gaps still constrain browsing away from the occluded region', () => {
  const hinge = { x: 540, y: 0, width: 34, height: 720, vertical: true };
  assert.equal(occludingFold(hinge), hinge);
  assert.equal(occludingFold(null), null);
});
