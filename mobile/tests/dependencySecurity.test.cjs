const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { quote } = require('shell-quote');
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRoot = path.dirname(expoRequire.resolve('@expo/cli/package.json'));
const cliRequire = createRequire(path.join(cliRoot, 'package.json'));
const { PluginSchema, DevToolsPluginOutputSchema } = cliRequire('./build/src/start/server/DevToolsPlugin.schema.js');
const { createMCPDevToolsExtensionSchema } = cliRequire('./build/src/start/server/createMCPDevToolsExtensionSchema.js');

test('shell quoting rejects line terminators after comments without executing a shell', () => {
  for (const separator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => quote(['echo', 'ok', { comment: 'comment' }, `value${separator}command;#`]), TypeError);
  }
  assert.equal(quote(['echo', 'two words']), "echo 'two words'");
});

for (const entry of ['deepmerge', 'deepmerge/dist/umd.js']) {
  test(`${entry} cannot poison returned objects through target or source keys`, () => {
    const merge = require(entry);
    const malicious = () => JSON.parse('{"__proto__":{"injected":true},"normal":1}');
    const results = [
      merge(malicious(), {}),
      merge(Object.create(null), malicious()),
      merge({ nested: malicious() }, { nested: { added: 2 } }).nested,
      merge({}, { nested: [malicious()] }).nested[0],
      merge.all([malicious(), { added: 2 }]),
    ];
    for (const result of results) {
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.injected, undefined);
      assert.equal(result.normal, 1);
    }
    assert.equal(Object.prototype.injected, undefined);
    assert.deepEqual(merge({ ios: { first: true }, plugins: ['a'] }, { ios: { second: true }, plugins: ['b'] }), {
      ios: { first: true, second: true }, plugins: ['a', 'b'],
    });
  });
}

test('Expo devtools schemas retain validation behavior with the patched Zod major', () => {
  const plugin = {
    packageName: 'test-plugin', packageRoot: '/test-plugin', bannerTitle: false,
    cliExtensions: {
      description: 'Test commands', entryPoint: './cli.js',
      commands: [{ name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'], parameters: [
        { name: 'count', type: 'number' }, { name: 'confirm', type: 'confirm' }, { name: 'text', type: 'text' },
      ] }],
    },
  };
  assert.equal(PluginSchema.safeParse(plugin).success, true);
  assert.equal(PluginSchema.safeParse({ ...plugin, packageName: '' }).success, false);
  assert.equal(PluginSchema.safeParse({ ...plugin, cliExtensions: { ...plugin.cliExtensions, commands: [] } }).success, false);
  const schema = createMCPDevToolsExtensionSchema(plugin);
  assert.equal(schema.safeParse({ command: 'inspect', count: 2, confirm: true, text: 'ok' }).success, true);
  assert.equal(schema.safeParse({ command: 'inspect' }).success, true);
  assert.equal(schema.safeParse({ command: 'missing' }).success, false);
  assert.equal(schema.safeParse({ command: 'inspect', count: 'two' }).success, false);
  assert.equal(schema.safeParse({ command: 'inspect', unknown: true }).success, false);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 'ok', level: 'info' }]).success, true);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'image', url: 'invalid' }]).success, false);
  assert.throws(() => createMCPDevToolsExtensionSchema({ packageName: 'empty' }), /no commands/);
});

test('updated Xcode project parser preserves project data and generates valid IDs', t => {
  const xcode = require('xcode');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-xcode-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'project.pbxproj');
  fs.writeFileSync(filename, `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 56;
  objects = {
/* Begin PBXProject section */
    AAAAAAAAAAAAAAAAAAAAAAAA = {
      isa = PBXProject;
      targets = ();
    };
/* End PBXProject section */
  };
  rootObject = AAAAAAAAAAAAAAAAAAAAAAAA;
}
`);
  const project = xcode.project(filename);
  project.parseSync();
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
  assert.equal(project.getFirstProject().uuid, 'AAAAAAAAAAAAAAAAAAAAAAAA');
  fs.writeFileSync(filename, project.writeSync());
  const reparsed = xcode.project(filename);
  reparsed.parseSync();
  assert.equal(reparsed.getFirstProject().uuid, project.getFirstProject().uuid);
});

test('legacy ESLint consumers use the patched matcher through a callable API', () => {
  const eslintRequire = createRequire(require.resolve('eslint/package.json'));
  const minimatch = eslintRequire('minimatch');
  assert.equal(typeof minimatch, 'function');
  assert.equal(minimatch('src/song.ts', '**/*.ts'), true);
  assert.equal(minimatch('src/song.ts', '**/*.js'), false);
  assert.deepEqual(['src/song.ts', 'src/song.js'].filter(minimatch.filter('**/*.ts')), ['src/song.ts']);
  assert.equal(new minimatch.Minimatch('**/*.ts').match('src/song.ts'), true);
  assert.equal(minimatch.defaults({ nocase: true })('SONG.TS', '*.ts'), true);
  assert.equal(minimatch.defaults({ nocase: true }).defaults({ dot: true })('.SONG.TS', '*.ts'), true);
  assert.equal(minimatch.makeRe('**/*.ts').test('src/song.ts'), true);
  assert.equal(minimatch.makeRe('*.@(ts|tsx)').test('song.tsx'), true);
  assert.equal(minimatch.makeRe('*.!(js)').test('song.ts'), true);
  assert.deepEqual(minimatch.braceExpand('*.{ts,tsx}'), ['*.ts', '*.tsx']);
});

test('cancelled glob traversal stops before reading directories', async t => {
  const { glob } = cliRequire('glob');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-glob-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'song.ts'), 'test');
  assert.deepEqual(await glob('**/*.ts', { cwd: directory }), ['nested/song.ts']);
  const controller = new AbortController();
  const reason = new Error('cancelled'); controller.abort(reason);
  let reads = 0;
  const trackedFs = { ...fs, readdir: (...args) => { reads++; return fs.readdir(...args); } };
  await assert.rejects(glob('**/*', { cwd: directory, signal: controller.signal, fs: trackedFs }), /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 0);
});

test('modern ESM consumers retain named matcher exports', async () => {
  const { minimatch, Minimatch, makeRe } = await import('minimatch');
  assert.equal(minimatch('src/song.ts', '**/*.ts'), true);
  assert.equal(new Minimatch('**/*.ts').match('src/song.ts'), true);
  assert.equal(makeRe('*.@(ts|tsx)').test('song.tsx'), true);
  assert.equal(makeRe('*.!(js)').test('song.ts'), true);
});

test('glob cancellation during traversal prevents further directory reads', async t => {
  const { glob } = cliRequire('glob');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-glob-midwalk-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (let i = 0; i < 8; i++) fs.mkdirSync(path.join(directory, `child-${i}`, 'nested'), { recursive: true });
  const controller = new AbortController(); let reads = 0;
  const trackedFs = { ...fs, readdir: (name, options, callback) => {
    reads++;
    fs.readdir(name, options, (...result) => {
      controller.abort(new Error('cancelled during read'));
      callback(...result);
    });
  } };
  await assert.rejects(glob('**/*', { cwd: directory, signal: controller.signal, fs: trackedFs }), /cancelled during read/);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(reads, 1);
});

test('both legacy engine formats bound adversarial preprocessing', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const engineRequire = createRequire(require.resolve('minimatch'));
    const esm = require('node:path').join(require('node:path').dirname(engineRequire.resolve('minimatch-engine/package.json')), 'dist/esm/index.js');
    (async () => {
      for (const engine of [engineRequire('minimatch-engine'), await import(require('node:url').pathToFileURL(esm).href)]) {
        const pattern = Array(30).fill('**/../a/b').join('/');
        const matcher = new engine.Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
        assert.equal(matcher.set.length, 64);
      }
    })();
  `;
  execFileSync(process.execPath, ['--max-old-space-size=64', '-e', script], {
    cwd: path.resolve(__dirname, '..'), timeout: 5000, stdio: 'pipe',
  });
});

test('the ESLint internal-modules rule retains its regex-generation API', () => {
  const { Linter } = require('eslint');
  const plugin = require('eslint-plugin-import');
  const linter = new Linter();
  const messages = linter.verify('import value from "example/allowed/file";', [{
    plugins: { import: plugin },
    rules: { 'import/no-internal-modules': ['error', { allow: ['**/allowed/*'] }] },
  }], { filename: 'example.js' });
  assert.deepEqual(messages, []);
});
