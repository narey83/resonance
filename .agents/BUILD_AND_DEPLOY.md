# Resonance agent quick start

Use this page to orient yourself before changing, building or deploying Resonance. `AGENTS.md` remains authoritative for safety and host restrictions.

## Current workflow — updated 29 October 2026

- The Mac checkout at `/Users/narey/Projects/resonance` is the source of truth.
- Develop, build and verify changes on the Mac, then commit and push to GitHub (`narey83/resonance`, `main`) for publication and distribution.
- Preserve local edits and commits. Fetch for comparison when needed, and deliberately reconcile incoming changes; never overwrite or reset Mac work to match GitHub or merely obtain a clean tree.
- Do not use the checkout on `192.168.0.80` / `dev-laptop.local` / `lan-server`, remote development helpers, VS Code Remote SSH or mobile source mirroring unless the user explicitly resumes that workflow.
- The reported server runtime is native. Docker/Compose guides remain available for other installations and historical context; they are not the active development or deployment workflow.
- Preserve application state, databases, credentials, dependencies and native projects. Never print secrets or signed URLs.
- The old `resonance-dev` / `192.168.0.254` host remains off limits unless the user explicitly requests access. Existing SMB consumption does not authorize administration.
- Mobile is an Expo SDK 57 React Native app with native modules. Expo Go is not a valid test target. Do not edit mirrored mobile files while a mirror is running.

## Local verification and human testing

A Git push publishes source; it does not deploy a running service. Do not access a server or change its runtime as part of a Git synchronization request. For implementation changes, build affected targets on the Mac and make the local result available for testing, or report a concrete blocker.

| Changed area | Required local verification |
| --- | --- |
| Documentation or Git synchronization only | Review the diff, check referenced paths and Git state. Runtime builds and deployment are not required. |
| `frontend/` | Relevant tests and lint, production build, then headless interaction and visual checks at desktop and narrow/mobile sizes against the locally served build. Use authenticated state for protected routes. |
| Backend/server code | Relevant .NET tests and build; exercise changed behavior against the local backend. Include client checks when the API contract changes. |
| Bridge | Relevant Go/UI tests and build; make the affected native application available for local testing. |
| `mobile/` TypeScript/styles | Relevant mobile lint/tests and current JS served through Metro to a compatible installed development client, or a new native development build. |
| Mobile native dependencies, plugins, permissions or config | Build and install the affected Android/iOS development client; Metro alone is insufficient. |

Inspect the private `.dev/config.json` runtime selector before running `bin/dev`: historical remote/server modes invoke remote helpers. Use local commands only. The README documents local development ports and commands. Do not expose private configuration in diagnostic output.

If a required tool, browser authentication, platform or local runtime is unavailable, report exactly which check or human-test target remains blocked. Never substitute a successful build or HTTP status for browser verification.

## Deployment

Deployment is separate from Git synchronization and needs an explicit request identifying the target. Use the approved native runtime workflow for that target, preserve private state, and verify the served artifact and changed behavior. Do not use the former development-server checkout or historical Compose updater by default.

## Mobile human-test flow

Read `mobile/AGENTS.md`, the exact Expo 57 documentation, and `mobile/EXPO_GUIDE.md` before editing. Native builds belong on the Mac checkout with its Android SDK/Xcode environment.

Install dependencies and build/install the appropriate development client:

```sh
cd mobile
npm ci
npx expo run:android
# or, on macOS with the intended simulator/device
npx expo run:ios
```

For TypeScript/style-only iteration with a compatible client already installed:

```sh
npx expo start --dev-client
```

Run the documented mobile lint/tests before handoff. Native configuration changes always require `expo run:android` and/or `expo run:ios`; Fast Refresh cannot install native changes.

## Fast decision guide

1. Read `git status --short` and preserve unrelated work.
2. Identify affected targets: web, backend, Android, iOS, or a combination.
3. Implement and run focused checks.
4. Build and serve/install every affected local human-test target; deploy remotely only when explicitly requested.
5. Verify the local artifact, application health, and changed behavior.
6. Report exactly what is ready, what was verified, and any platform still blocked.
