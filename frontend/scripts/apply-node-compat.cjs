// Small compatibility fixes for the exact legacy versions pinned by react-scripts.
// Keep warnings enabled; replace the deprecated operations at their source.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const fromFrontend = createRequire(path.join(__dirname, '../package.json'));

const patchPackage = (name, version, files, before, after) => {
  const manifest = fromFrontend.resolve(name + '/package.json');
  const installed = JSON.parse(fs.readFileSync(manifest));
  if (installed.version !== version) return 0;
  let changed = 0;
  for (const relative of files) {
    const file = path.join(path.dirname(manifest), relative);
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes(before)) {
      fs.writeFileSync(file, source.replaceAll(before, after));
      changed++;
    } else if (!source.includes(after)) {
      throw new Error('Unexpected source for compatibility fix: ' + file);
    }
  }

  return changed;
};

const applyCompatibilityPatches = () => {
  return (
    patchPackage(
      'http-proxy',
      '1.18.1',
      ['lib/http-proxy/index.js', 'lib/http-proxy/common.js'],
      "require('util')._extend",
      'Object.assign',
    ) +
    patchPackage(
      'eslint-plugin-n',
      '16.6.2',
      ['lib/converted-esm/import-meta-resolve.js'],
      'return new import_node_fs2.Stats();',
      'return { isFile: () => false, isDirectory: () => false };',
    )
  );
};

module.exports = { applyCompatibilityPatches };
if (require.main === module) {
  const count = applyCompatibilityPatches();
  if (count) console.log('Applied ' + count + ' Node compatibility fixes.');
}
