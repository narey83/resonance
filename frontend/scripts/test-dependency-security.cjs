const assert = require('node:assert/strict');
const { test } = require('node:test');
const merge = require('deepmerge');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { Linter } = require('eslint');

const canonicalRequire = createRequire(
  require.resolve('eslint-config-canonical/package.json'),
);
const scriptsRequire = createRequire(
  require.resolve('react-scripts/package.json'),
);
const legacyGlob = scriptsRequire('glob');
const importPlugin = canonicalRequire('eslint-plugin-import');

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

test('legacy consumers retain callable matching, regexes and defaults', () => {
  const consumer = createRequire(require.resolve('eslint/package.json'));
  const matcher = consumer('minimatch');
  assert.equal(typeof matcher, 'function');
  assert.equal(matcher('src/song.jsx', '**/*.jsx'), true);
  assert.equal(matcher('src/song.js', '**/*.jsx'), false);
  assert.equal(matcher.makeRe('*.@(js|jsx)').test('song.jsx'), true);
  assert.equal(matcher.makeRe('*.!(txt)').test('song.jsx'), true);
  assert.deepEqual(['a.js', 'b.txt'].filter(matcher.filter('*.js')), ['a.js']);
  assert.equal(
    matcher.defaults({ nocase: true }).defaults({ dot: true })(
      '.SONG.JS',
      '*.js',
    ),
    true,
  );
  assert.deepEqual(matcher.braceExpand('*.{js,jsx}'), ['*.js', '*.jsx']);
});

test('ESM consumers retain named exports and legacy regex construction', async () => {
  const {
    default: callable,
    minimatch,
    Minimatch,
    makeRe,
  } = await import('minimatch');
  assert.equal(typeof callable, 'function');
  assert.equal(minimatch('src/song.jsx', '**/*.jsx'), true);
  assert.equal(new Minimatch('**/*.jsx').match('src/song.jsx'), true);
  assert.equal(makeRe('*.@(js|jsx)').test('song.jsx'), true);
});

test('both engine formats bound adversarial glob preprocessing', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const path = require('node:path');
    const { pathToFileURL } = require('node:url');
    const local = createRequire(require.resolve('minimatch'));
    const esm = path.join(path.dirname(local.resolve('minimatch-engine/package.json')), 'dist/esm/index.js');
    (async () => {
      for (const engine of [local('minimatch-engine'), await import(pathToFileURL(esm).href)]) {
        const matcher = new engine.Minimatch(Array(30).fill('**/../a/b').join('/'), { optimizationLevel: 2, braceExpandMax: 64 });
        assert.equal(matcher.set.length, 64);
      }
    })();
  `;
  execFileSync(process.execPath, ['--max-old-space-size=64', '-e', script], {
    cwd: path.resolve(__dirname, '..'),
    timeout: 5_000,
    stdio: 'pipe',
  });
});

test('the installed ESLint import rule still allows and rejects internal paths', () => {
  const linter = new Linter();
  linter.defineRule(
    'import/no-internal-modules',
    importPlugin.rules['no-internal-modules'],
  );
  const config = {
    parserOptions: { ecmaVersion: 2_022, sourceType: 'module' },
    rules: {
      'import/no-internal-modules': ['error', { allow: ['**/index.cjs'] }],
    },
  };
  assert.deepEqual(
    linter.verify('import value from "deepmerge/index.cjs";', config, {
      filename: path.join(__dirname, 'fixture.js'),
    }),
    [],
  );
  const blocked = linter.verify(
    'import value from "deepmerge/package.json";',
    config,
    { filename: path.join(__dirname, 'fixture.js') },
  );
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].ruleId, 'import/no-internal-modules');
});

test('the installed legacy glob preserves nested traversal and ignore patterns', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-glob-'));
  try {
    fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'ignored'));
    fs.writeFileSync(path.join(directory, 'src/song.js'), '');
    fs.writeFileSync(path.join(directory, 'src/note.txt'), '');
    fs.writeFileSync(path.join(directory, 'ignored/file.js'), '');
    const matches = await new Promise((resolve, reject) => {
      legacyGlob(
        '**/*.js',
        { cwd: directory, ignore: ['**/ignored/**'], nodir: true },
        (error, files) => {
          if (error) reject(error);
          else resolve(files);
        },
      );
    });
    assert.deepEqual(matches, ['src/song.js']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the modern TypeScript parser consumer resolves patched upstream matching', () => {
  const canonical = createRequire(
    require.resolve('eslint-config-canonical/package.json'),
  );
  const parser = canonical('@typescript-eslint/typescript-estree');
  const consumer = createRequire(
    canonical.resolve('@typescript-eslint/typescript-estree'),
  );
  const version = consumer('minimatch/package.json').version;
  assert.ok(Number(version.split('.')[0]) >= 11);
  const tree = parser.parse('const value: string = "ok";', {
    filePath: 'fixture.ts',
  });
  assert.equal(tree.body[0].type, 'VariableDeclaration');
});
