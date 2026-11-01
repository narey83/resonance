# minimatch 10 security backport

This contains the Blue Oak licensed upstream minimatch 10.2.6 distributions and
TypeScript declarations, with the fix from upstream commit
https://github.com/isaacs/minimatch/commit/77a0f5c backported to both JS entry points.
The `**/..` optimization stops expanding at `braceExpandMax`, and quadratic
pairwise deduplication is skipped above 1000 patterns. This fixes
https://github.com/advisories/GHSA-g3hv-75wg-m249 while retaining `makeRe`, which
ESLint's import plugin still calls and minimatch 11 removed.

The local version identifies the backport; no advisory is suppressed. Source
maps are omitted to avoid referring to unpatched sources; trailing whitespace
on four expression-continuation lines is normalized. Module-level generated
`var` declarations use `let` to meet the project lint rules. Unused tuple slots
use destructuring elisions, and ES module imports precede declarations.
Original distribution SHA-256 values before the backport:

commonjs/index.js: d224f71f20d7c206fcc5b7e9f747324c7698345a0b2c28d717dd9cf698306783
esm/index.js: 59821ec2ce0d3df968292036e5c831ad322b33e9c33a949ecbc9dfe125d165be

TypeScript ESLint parser consumers use upstream minimatch 11.0.3 directly. Keep
this backport only until legacy callers migrate.
