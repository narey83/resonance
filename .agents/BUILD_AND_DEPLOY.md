# Resonance agent quick start

Use this page to orient yourself before changing, building or deploying Resonance. `AGENTS.md` remains authoritative for safety and host restrictions.

## Web development mode — user instruction, 2 November 2026

The current web instance must run as a **development build with hot reload**.
Do not rebuild and publish production bundles for routine UI edits. The active
`resonance-web-dev.service` on the dev laptop runs `npm start` from
`/home/narey/resonance-builds/upload-folder-label-20261102/frontend`; the normal
public URL proxies to its loopback port 18770, including the `/ws` HMR socket.
Edit on the Mac, deliberately transfer only changed source files to that isolated
source directory, and let the running watcher update the browser. Do not enable
automatic source mirroring. Preserve the existing backend and private state.
Run relevant lint/tests and authenticated desktop/narrow browser checks; verify
hot reload for changes to the development delivery path. Dependency/configuration
changes may need a deliberate dev-service restart. A production build is required
only when the user explicitly requests production/release delivery.

## Current workflow — updated 30 October 2026

- The Mac checkout at `/Users/narey/Projects/resonance` is the source of truth.
- Edit and manage Git on the Mac. Build, test and run services on `dev-laptop.local` until the user explicitly permits Mac runtimes again, then commit and push to GitHub (`narey83/resonance`, `main`).
- Preserve local edits and commits. Fetch for comparison when needed, and deliberately reconcile incoming changes; never overwrite or reset Mac work to match GitHub or merely obtain a clean tree.
- The user explicitly resumed dev-laptop use on 30 October 2026. Use isolated source snapshots there; preserve its checkout, private configuration and databases. Do not start Mac web/backend/Metro/QA servers or use the historical Docker helpers.
- The reported server runtime is native. Docker/Compose guides remain available for other installations and historical context; they are not the active development or deployment workflow.
- Preserve application state, databases, credentials, dependencies and native projects. Never print secrets or signed URLs.
- The old `resonance-dev` / `192.168.0.254` host remains off limits unless the user explicitly requests access. Existing SMB consumption does not authorize administration.
- Mobile is an Expo SDK 57 React Native app with native modules. Expo Go is not a valid test target. Do not edit mirrored mobile files while a mirror is running.

## Local verification and human testing

A Git push publishes source; it does not deploy a running service. Do not access a server or change its runtime as part of a Git synchronization request. For implementation changes, build affected targets on the dev laptop and make that result available for testing, or report a concrete blocker.

| Changed area | Required local verification |
| --- | --- |
| Documentation or Git synchronization only | Review the diff, check referenced paths and Git state. Runtime builds and deployment are not required. |
| `frontend/` | Relevant tests and lint, successful development compilation/hot reload, then headless interaction and visual checks at desktop and narrow/mobile sizes on the dev laptop. Run a production build only for an explicitly requested production release. Use authenticated state for protected routes. |
| Backend/server code | Relevant .NET tests and build; exercise changed behavior against the dev-laptop backend. Include client checks when the API contract changes. |
| Bridge | Relevant Go/UI tests and build; make the affected native application available for local testing. |
| `mobile/` TypeScript/styles | Relevant mobile lint/tests and current JS served through Metro on the dev laptop to a compatible installed development client, or a new native development build. |
| Mobile native dependencies, plugins, permissions or config | Build and install the affected Android/iOS development client; Metro alone is insufficient. |

Inspect the private `.dev/config.json` runtime selector before running `bin/dev`: historical remote/server modes invoke remote helpers. Use local commands only. The README documents local development ports and commands. Do not expose private configuration in diagnostic output.

If a required tool, browser authentication, platform or local runtime is unavailable, report exactly which check or human-test target remains blocked. Never substitute a successful build or HTTP status for browser verification.

## Deployment

Deployment is separate from Git synchronization and needs an explicit deployment request. The established default live destination and mobile delivery workflow are recorded in [DEPLOYMENT.md](DEPLOYMENT.md); read it first and do not ask the user to repeat those known destinations. Use that native runtime workflow, preserve private state, and verify the served artifact and changed behavior. Do not use the server checkout as a development workspace or run the historical Compose updater by default.

## Mobile human-test flow

Read `mobile/AGENTS.md`, the exact Expo 57 documentation, and `mobile/EXPO_GUIDE.md` before editing. Build and serve on the dev laptop under the standing user restriction. A native iOS/Xcode build needs an explicit exception before using the Mac.

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
3. Edit on the Mac and run focused checks on an isolated dev-laptop snapshot.
4. Build and serve affected targets on the dev laptop; deploy/install only the requested targets. Mac-side SSH/ADB forwarding is transport only.
5. Verify the local artifact, application health, and changed behavior.
6. Report exactly what is ready, what was verified, and any platform still blocked.
