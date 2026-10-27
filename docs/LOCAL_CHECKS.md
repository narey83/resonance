# Local checks in VS Code

Open the repository root (over Remote SSH for server development), accept the
recommended C# and ESLint extensions, and reload the window after updating these
settings. The C# extension loads `resonance.sln` and reports compiler and analyzer
diagnostics across the solution. The existing StyleCop package and ruleset remain
the source of the C# rules.

Saving a C# file formats it and applies available fixes on an explicit save.
Saving JavaScript/TypeScript or frontend JSON applies ESLint fixes, including the
frontend's Prettier rules. Review remaining Problems entries: some StyleCop member
ordering and test rules need a manual edit.

Enable the commit check once in every clone:

```sh
git config core.hooksPath .githooks
```

The hook checks an isolated copy of the Git index. Stage fixes before retrying:
unstaged fixes deliberately do not count. It never stashes or rewrites work.
CommonJS and ES module scripts are included; frontend JSON is linted too.
Missing validation tools or npm dependencies block a commit rather than skipping
checks.

For backend, test, analyzer or build-configuration changes, the hook runs a
Release solution build with temporary outputs and rejects any StyleCop warning,
matching CI. This includes package restore and can take a few minutes. Other
existing warning categories retain their CI behavior. Node dependencies must
already be installed in each affected project; the hook reuses them read-only.

Run the hook regression tests with:

```sh
python3 .githooks/test_pre_commit.py
```

CI remains the clean-checkout check for the complete test suite and native
Android/iOS builds. The iOS CI artifact is an unsigned simulator app; installing
on physical iPhones or distributing through TestFlight requires Apple signing.
