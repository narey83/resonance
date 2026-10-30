const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(require('node:path').dirname(module.filename), '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');

// Execute the production TypeScript with native boundaries replaced. Each test gets its own
// module graph, so sessions, request queues, and timers cannot leak between test cases.
function mobileModules(mocks = {}, globals = {}) {
  const cache = new Map();
  const replacements = new Map(Object.entries(mocks).map(([key, value]) =>
    [key.startsWith('src/') ? path.join(root, key) : key, value]));
  function load(name, parent = path.join(root, 'index.ts')) {
    const resolved = name.startsWith('.') || name.startsWith('/')
      ? path.resolve(path.dirname(parent), name) : name;
    const file = resolved.startsWith(root) && !path.extname(resolved)
      ? ([`${resolved}.ts`, `${resolved}.tsx`].find(candidate => replacements.has(candidate) || fs.existsSync(candidate)) ?? `${resolved}.ts`) : resolved;
    if (replacements.has(file)) return replacements.get(file);
    if (!file.startsWith(root)) return localRequire(name);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    });
    const run = new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'Date', outputText);
    run((dependency) => load(dependency, file), module, module.exports,
      globals.setTimeout ?? setTimeout, globals.clearTimeout ?? clearTimeout, globals.Date ?? Date);
    return module.exports;
  }
  return (name) => load(path.join(root, name));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(setImmediate);
const jwt = (name, exp = Math.floor(Date.now() / 1000) + 3600) =>
  `header.${Buffer.from(JSON.stringify({ name, exp, role: 'Administrator' })).toString('base64url')}.signature`;

function secureStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}
module.exports = { mobileModules, deferred, tick, jwt, secureStorage, localRequire };
