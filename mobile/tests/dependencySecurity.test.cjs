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
