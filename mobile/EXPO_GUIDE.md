# Mobile development with Expo

Updated **30 October 2026** for the current Expo SDK 57 source. Dependencies and native tooling can change; check `package.json`, `app.json`, the lockfile and the [versioned Expo SDK documentation](https://docs.expo.dev/versions/v57.0.0/) before making changes.

## Use a development build

Resonance uses React Native Track Player, Google Cast, keyboard control and custom Android modules. Expo Go does not include all of these native components. A development build includes them and loads the current JavaScript from Metro.

`npx expo start` starts Metro; it does not compile or install a native app. First build the app for your device or simulator, then use Metro for ordinary TypeScript and styling changes.

## Requirements

- Node.js **22.13 or newer** and **npm 11 or newer** for Expo SDK 57.
- Android: Android SDK platform/build tools 36, a compatible Java toolchain and an emulator or USB-debugging device. The repository's Android CI uses JDK 17; generated native builds can also require the NDK and CMake.
- iOS: macOS, a compatible Xcode installation with an iOS simulator runtime, and CocoaPods. SDK 57 documents Xcode 26.4+ and iOS 16.4+; physical-device and distribution builds require signing.
- A running Resonance backend reachable from the test device.

See the [Expo SDK compatibility table](https://docs.expo.dev/versions/v57.0.0/#each-expo-sdk-version-depends-on-a-react-native-version) for the current React Native, Node and OS requirements. Do not infer mobile requirements from the web frontend's Node requirement.

## Install and build

From `mobile/`:

```bash
npm ci

# Build the separate development client on the dev laptop, then install it
APP_VARIANT=development npx expo prebuild --clean --platform android --no-install
APP_VARIANT=development npx expo run:android

# Or build and install on an iOS simulator, on macOS
APP_VARIANT=development npx expo prebuild --clean --platform ios --no-install
APP_VARIANT=development npx expo run:ios
```

The native `android/` and `ios/` directories are generated and ignored by Git. Configuration plugins apply the native customisations from `app.json`; keep durable changes in those plugins rather than only editing generated files.

The app connects directly to your Resonance server over HTTP and SignalR. No Firebase project, Google services configuration, or push-service secret is required. SignalR delivers live updates while connected; returning to the app checks the server for changes missed while suspended. Local notifications remain available for events received by the app. A closed or suspended app cannot promise immediate alerts without an operating-system push service.

On Android, the optional **Background chat alerts** switch starts a first-party foreground service. It checks the server's PM and room-mention feed every 15 seconds over HTTPS and shows a persistent system notification while active. This does not use Firebase, Pushbullet or an external push provider. Android can stop a foreground service under resource pressure, and force-stop or reboot ends it until the app is opened again. The feed uses the signed-in device's current refresh credential, stops after revocation or absolute expiry, and never stores that credential in native preferences. iOS still has no closed-app delivery path.

Google Cast's Android SDK is pinned to **22.3.1** through `androidPlayServicesCastFrameworkVersion` in `app.json`. The plugin defaults to `+`, which now resolves Cast 23 and a media-router dependency requiring Android 37 / AGP 9.1; Expo SDK 57 uses Android 36 / AGP 8.12. Keep this pin when regenerating native projects, and review the complete native toolchain before upgrading Cast. A first build needs network access to download uncached Maven artifacts; offline mode works only after those dependencies have been cached.

## Normal development

After installing a compatible development build:

```bash
APP_VARIANT=development EXPO_PACKAGER_PROXY_URL=http://127.0.0.1:8083 \
  npx expo start --dev-client --localhost --port 8083
```

The development client uses the **Resonance Dev** name, `com.resonance.mobile.dev`
on Android, `com.resonance.mobile.dev` on iOS, and the `resonance-dev` link scheme.
The default `app.json` configuration keeps the production identity.
Keep `APP_VARIANT=development` set for Metro as well as the native build. A
previously generated `android/` directory retains its old package until prebuild
regenerates it. Installing the development package leaves the production package
and its app data separate. On the Pixel, forward only the development port
(`adb -s PIXEL_TARGET reverse tcp:8083 tcp:8083`) and open the development
client with `exp+resonance-mobile-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8083`.
The existing app and its Metro forwarding on ports 8081/8082 stay separate.

TypeScript, JavaScript and styles normally update through Fast Refresh. Rebuild after adding/removing native dependencies, changing native plugins or permissions, or updating the SDK/native runtime. An old installed binary may not match a newly upgraded JavaScript bundle.

Keep the `expo` import first in `index.ts`, before application and native-dependent imports. Expo's startup side effects initialize React Native globals before modules such as SecureStore load. Importing those modules first can leave `globalThis.expo` undefined and fail with an `EventEmitter` error before the main screen registers. `tests/entrypoint.test.cjs` exercises a cold startup and playback-service registration order.

For Expo packages, use the SDK-aware installer:

```bash
npx expo install expo-camera
```

Use the ordinary npm workflow for compatible JavaScript-only packages. Retain intentional `patch-package` patches and inspect their compatibility when upgrading native dependencies.

## Connect to a server

Enter the server's base address in the app or scan its pairing QR. Pairing exchanges a short-lived code for a session; it does not put the user's password in the QR.

- A real phone needs an address reachable over its network. Its own `localhost` is not the Mac or server.
- An iOS simulator can normally reach a Mac-hosted service through the Mac's loopback address.
- Android emulators can use their host gateway, or an explicit development `adb reverse` tunnel to a local service.

Use an isolated server/library when testing downloads, file management, mixtape edits or playback history. Never commit credentials, pairing codes, signed stream URLs, captured private messages.

## Checks

```bash
npm test
npm run audit:security
npx eslint .
npx tsc --noEmit
```

Dependency security maintenance (30 October 2026): the lockfile updates `shell-quote` to 1.12.0, Axios to 1.21.0 and compatible Expo 57 tooling. The unused `expo-music-info-2` package and its obsolete nested Expo FileSystem were removed. ExpoModulesJSI 57.1.3 includes the Swift-interface fix, so its old local patch is no longer needed.

The scoped `@expo/cli` Zod override selects 4.6.7 or newer. Regression tests exercise Expo's plugin descriptors, command schemas and output validation against that major version. Keep the override until Expo's declared dependency accepts a patched Zod release.

Security maintenance (1 November 2026): `glob` is overridden to 14.0.3 for
[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).
Modern Glob, Expo fingerprint and TypeScript ESLint consumers use minimatch 11.0.3
for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint's legacy callable/regex API uses `vendor/minimatch-compat` with the narrow
upstream preprocessing-limit fix backported to minimatch 10.2.6 in
`vendor/minimatch-engine`. Its README records provenance and the upstream fix;
regression tests exercise both module formats and the actual ESLint rule.

`deepmerge` still has no published patched release for
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
`vendor/deepmerge` reuses the repository's audited security backport, defining own
data properties so `__proto__` cannot change merged objects' prototypes. The root
override routes all consumers to that explicit local version, replacing the old
postinstall patch. Keep these backports until compatible upstream fixes exist;
no advisories are suppressed. npm 11+ is required to resolve the local overrides.

Then build and exercise the affected platform. Type checks cannot validate native linking, background playback, notification delivery, device permissions, casting or Android Auto. Screenshots are visual evidence for the displayed screens, not a substitute for those integration tests.

After installing a rebuilt Android development APK, the playback-service lifecycle regression can run on an emulator with Metro disconnected:

```bash
ANDROID_SERIAL=emulator-5554 npm run test:android-service
```

Set `ADB_PATH` if `adb` is outside your shell's path. This test stops the Resonance test app, opens its development launcher, and creates and destroys its playback service three times before the real player is initialized. It verifies that the service is destroyed and that the app survives without a new native crash. The playback package patch must release the media session even when `setupPlayer()` has not run; otherwise the next service creation can fail with “Session ID must be unique.”

## Distribution

`eas.json` defines development, preview and production profiles. Local builds do not require an EAS cloud build. The repository's CI/release workflows build Android APKs; production store distribution and iOS signing/provisioning need their own configuration and validation.

Feature descriptions, platform differences and the current gallery live in the [mobile guide](README.md). Native screenshot capture instructions live in the [screenshot guide](../docs/screenshots/mobile/README.md).

Studio native changes require rebuilding the Android/iOS development client. The version 2 engine adds `StudioTone.h`, eight EQ gains, dynamic bass/treble controls and preset Amount to the native configuration. Run `node scripts/install-studio.cjs` before a native rebuild; both platforms must receive the updated bridge and shared header together. The `withStudio` plugin installs the shared DSP and native bridges into TrackPlayer, and adds a CocoaPods post-install adjustment to preload SwiftAudioEx audio tracks. Keep `patch-package && node scripts/install-studio.cjs` as the postinstall command. Android uses the app's NDK version and CMake 3.22.1 or newer. Audio offload stays disabled to preserve the processing path.

All Studio sliders, including Mastering and Creative modules, use the Expo 57 compatible `@react-native-community/slider` 5.2.0. Rebuild both development clients after installing this native dependency; Metro refresh alone cannot add its view. Older clients show a rebuild notice instead of rendering an unavailable slider.

Expo modules are built from source (`expo-build-properties.ios.usePrecompiledModules: false`) to avoid the Swift 6.3 precompiled-module interface mismatch with the installed Swift 6.4 / Xcode 27.1 toolchain. React Native can continue using its prebuilt core.

ExpoModulesJSI 57.1.3 includes Swift-interface cleanup for Swift 6.4's `__ObjC::` spelling as well as `__ObjC.`. The older local patch is no longer needed. Leaving these C++ extensions in the public interface prevents importing ExpoModulesJSI on Xcode 27.1.

Recent-server biometric sign-in uses the existing `expo-secure-store` native module, with `requireAuthentication: true` and a dedicated keychain service. Its config-plugin Face ID description explains saved-server sign-in. No new biometric library is required; rebuild an older client if its Face ID usage description is missing. Real-device verification requires an enrolled Face ID / Touch ID / strong Android biometric.

Remote sessions renew silently while the app is active and when it resumes. Temporary network/server failures preserve credentials for retry. Session lifetime and idle timeout remain controlled by the server; definitive rejection of refresh credentials still requires sign-in.

Restore saved credentials only once per loaded app, retrying if secure storage failed. Remounts and Fast Refresh must preserve the current session generation: resetting it during a token rotation can discard the successful response and leave an old refresh token saved.

### macOS emulator launcher stability

The custom Android Emulator app bundle must launch the SDK's `emulator` launcher with the SDK and AVD directories configured, rather than invoking `qemu-system-aarch64` directly. Direct launches produced repeated macOS DYLD failures for `libandroid-emu-tracing.dylib`. The launcher establishes the emulator library paths and selects the test AVD.

The test Mac also recorded EGL/gfxstream segmentation faults. Its test AVD now uses software graphics and cold boots (`-gpu software -no-snapshot`), with the previous launcher and AVD settings backed up beside the original files. This avoids restoring incompatible graphics snapshots without wiping installed apps or user data. Verify a completed Android boot and usable app window after changing the host setup.

Android Auto DHU testing requires the full Android Auto app; the placeholder package in a Google APIs image cannot provide projection. Use a Play-enabled image or a connected test handset and complete Google's Android Auto setup before treating DHU connection attempts as app tests.

## Adaptive screens (October 2026)

`app.json` allows system orientation on Android and iOS. Rebuild native apps after changing orientation configuration or `withAdaptiveWindow`; Metro refresh alone cannot update the native orientation mask or install the hinge module.

The player uses live window dimensions, two columns on wide windows, and scrollable controls in short windows. Android WindowManager reports separating folds/occluding hinges through `AdaptiveWindow`: player panels straddle the fold, while sheets stay in a single usable pane. Browsing fills the window across a non-occluding crease; it is constrained to a pane only for a physical hinge gap. A normal unfolded crease is not treated as an occlusion. The floating player reclamps after resizing.

Simulator QA: iPhone 17 portrait and landscape, direct playlist chooser and Studio entry; Pixel Fold unfolded, folded cover display, half-open book posture and rotated tabletop posture. A local track kept playing and retained its position through fold/unfold. Physical dual-screen hardware with an occluding gap still needs device QA; synthetic geometry tests cover nonzero hinge widths and stale rotation geometry. Android and iOS native development builds passed; 91 mobile tests passed.

## Messaging keyboard and link previews

Chatrooms and private messages use one `KeyboardAvoidingView` around the message list and composer. Its offset includes the navigation header and the visible mini-player height. Keep that explicit header offset: automatic position detection on the current Android build left the composer behind the keyboard. Avoid combining a moving composer with a separately animated spacer in the inverted list. The latest-message follower handles arrivals and layout changes.

Link previews are warmed from joined-room histories and recent private conversations before their screens open. The client warms the four most recent private histories once per last-message revision, without acknowledging messages. Each warming batch examines the newest 20 messages, queues at most 24 URLs and fetches two previews concurrently. Resolved metadata is available synchronously to cards; image prefetching uses the native image cache. Metadata cache entries are account-scoped, limited to 128, expire after five minutes, and retry failures after 30 seconds. Network availability still determines whether a new preview can be ready in advance.

## First-play startup (1 November 2026)

Discover publishes library tracks, new albums and resolved history independently.
Slow notes, searches, transfers or playlist requests no longer hold back playable
sections. Refresh generations prevent an older or blurred-screen request from
overwriting the active refresh. `tests/discoveryPlayback.test.cjs` covers pending
requests, partial failures and cancelled refreshes.

Android starts after buffering 0.5 seconds of audio; its forward-buffer targets
remain 30–120 seconds. iOS keeps its existing settings. The native Android player
also derives its rebuffer threshold from this startup value, so slower links may
resume sooner after a stall. Do not interpret the threshold as guaranteed wall-clock
startup time: connection setup, file reads and decoding still contribute.

Laptop verification: 194 mobile tests, TypeScript checking, lint and Android/iOS
bundle exports passed. On the Pixel, the checked first play reached Android's
playing state in about 1.0 second (earlier baseline about 1.2 seconds); these small
samples do not establish a consistent speedup across files or networks. The
dependency audit at that point reported 27 findings; the security maintenance
above replaces those affected dependencies.

Security verification (1 November 2026): a clean npm 11 install, all 200 mobile
tests, TypeScript, lint and Android/iOS bundle exports passed on the dev laptop.
The full audit, including low-severity findings, reports zero vulnerabilities.

## Album identity in Discover (1 November 2026)

New arrivals, unheard-track prefetching and Library album details share
`services/albumTracks.ts`. Matching requires the album title and album artist;
when a track lacks an album-artist tag, its artist must match the card, except
that Various Artists compilations retain untagged performers. This prevents
different artists with the same album title and folder from sharing a queue.
Single-track cards resolve their exact cover-track path; larger results are
paged before filtering so a matching artist beyond the first page is retained.
An empty result never starts another artist's tracks.

The regression fixtures include the four HYS007 arrival cards, mixed tags,
compilations, tagged guest performers, pagination and account changes. All 206
mobile tests, TypeScript, lint with zero warnings, the dependency audit and
Android/iOS bundle exports passed on the dev laptop.
