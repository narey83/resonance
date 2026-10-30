const assert = require('node:assert/strict');
const { test } = require('node:test');
const merge = require('deepmerge');

const injectedResult = () => ({ injected: true });
const chooseInjected = () => injectedResult;
const useRight = (_left, right) => right;
const chooseRight = () => useRight;

const payload = () => JSON.parse('{"__proto__":{"injected":true}}');
const assertSafe = (result) => {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.injected, undefined);
  assert.equal(
    Object.getOwnPropertyDescriptor(Object.prototype, 'injected'),
    undefined,
  );
};

test('merging into a null-prototype target cannot poison the returned prototype', () => {
  assertSafe(merge(Object.create(null), payload()));
});

test('cloning a target with an own __proto__ property cannot poison the returned prototype', () => {
  assertSafe(merge(payload(), { safe: true }));
});

test('custom merging of an own __proto__ property cannot invoke its inherited setter', () => {
  const result = merge(payload(), payload(), {
    customMerge: chooseInjected,
  });
  assertSafe(result);
});

test('nested objects and array elements retain safe prototypes', () => {
  const result = merge({ nested: payload(), items: [payload()] }, {});
  assertSafe(result.nested);
  assertSafe(result.items[0]);
});

test('configuration merging preserves arrays, symbols and custom merge callbacks', () => {
  const symbol = Symbol('setting');
  const target = { nested: { left: 1 }, items: [1], [symbol]: { left: 1 } };
  const source = { nested: { right: 2 }, items: [2], [symbol]: { right: 2 } };
  const result = merge(target, source);
  assert.deepEqual(result, {
    nested: { left: 1, right: 2 },
    items: [1, 2],
    [symbol]: { left: 1, right: 2 },
  });
  assert.notEqual(result.nested, target.nested);
  assert.deepEqual(merge.all([{ count: 1 }, { enabled: true }]), {
    count: 1,
    enabled: true,
  });
  assert.deepEqual(
    merge(
      { items: [1] },
      { items: [2] },
      {
        customMerge: chooseRight,
      },
    ),
    { items: [2] },
  );
});
