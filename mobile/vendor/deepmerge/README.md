# deepmerge security backport

This is the MIT-licensed CommonJS distribution and TypeScript declarations from
`deepmerge` 4.3.1, with a local fix for
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
There was no patched upstream release on 30 October 2026.
The upstream `dist/cjs.js` SHA-256 is
`2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`.

All three writes to a merge destination now use `Object.defineProperty` to create
own data properties. An enumerable `__proto__` key in either input, including a
null-prototype input or a custom merge result, cannot invoke the inherited
prototype setter. Normal object prototypes and the upstream merge API are retained.
No advisory is suppressed. The package has an explicit local version,
`4.3.1-resonance.1`, and the root override routes every consumer to this copy.

Run `node --test tests/dependencySecurity.test.cjs` to exercise the exploit paths, nested
objects and arrays. Keep the upstream licence alongside
the distribution. Replace this backport with an upstream patched release when one
is available, then rerun the full audit, tests, production build and dev-server
HTTP/WebSocket checks.

The mobile copy normalizes `var` declarations to `let` for the project lint rules.
