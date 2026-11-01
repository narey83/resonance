# Legacy minimatch interface

ESLint 9 and plugins call `require('minimatch')` directly. This adapter exposes a
callable CommonJS interface and preserves named exports for the locally patched
minimatch 10 engine. All matching and regex construction use that engine, whose
README records the upstream security fix and distribution provenance.

The package also provides an ES module entry point. Modern Glob, Expo fingerprint
and TypeScript ESLint consumers are overridden separately to upstream minimatch
11.0.3. The legacy engine retains the regex-generation API used by ESLint's
`import/no-internal-modules` rule. Tests cover matching, defaults, regex generation,
ESM exports and the upstream pattern-expansion limit.
