// Keep the callable minimatch 3 interface for ESLint's legacy consumers, while
// using only the patched upstream engine for matching and pattern compilation.
function legacy(api) {
  const implementation = typeof api === 'function' ? api : api.minimatch;
  const match = (path, pattern, options) => implementation(path, pattern, options);
  Object.assign(match, api);
  match.defaults = options => legacy(api.defaults(options));
  return match;
}
module.exports = legacy(require('minimatch-engine'));
