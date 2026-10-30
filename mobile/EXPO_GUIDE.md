# Mobile development with Expo

Updated **30 October 2026** for the current Expo SDK 57 source. Dependencies and native tooling can change; check `package.json`, `app.json`, the lockfile and the [versioned Expo SDK documentation](https://docs.expo.dev/versions/v57.0.0/) before making changes.

## Use a development build

Resonance uses React Native Track Player, Google Cast, keyboard control and custom Android modules. Expo Go does not include all of these native components. A development build includes them and loads the current JavaScript from Metro.

`npx expo start` starts Metro; it does not compile or install a native app. First build the app for your device or simulator, then use Metro for ordinary TypeScript and styling changes.

## Requirements

- Node.js **22.13 or newer** for Expo SDK 57, and npm.
- Android: Android SDK platform/build tools 36, a compatible Java toolchain and an emulator or USB-debugging device. The repository's Android CI uses JDK 17; generated native builds can also require the NDK and CMake.
- iOS: macOS, a compatible Xcode installation with an iOS simulator runtime, and CocoaPods. SDK 57 documents Xcode 26.4+ and iOS 16.4+; physical-device and distribution builds require signing.
- A running Resonance backend reachable from the test device.

See the [Expo SDK compatibility table](https://docs.expo.dev/versions/v57.0.0/#each-expo-sdk-version-depends-on-a-react-native-version) for the current React Native, Node and OS requirements. Do not infer mobile requirements from the web frontend's Node requirement.

## Install and build

From `mobile/`:

```bash
npm ci

# Build and install on an Android emulator or connected device
npx expo run:android

# Or build and install on an iOS simulator, on macOS
npx expo run:ios
```

The native `android/` and `ios/` directories are generated and ignored by Git. Configuration plugins apply the native customisations from `app.json`; keep durable changes in those plugins rather than only editing generated files.

The app connects directly to your Resonance server over HTTP and SignalR. No Firebase project, Google services configuration, or push-service secret is required. SignalR delivers live updates while connected; returning to the app checks the server for changes missed while suspended. Local notifications remain available for events received by the app. A closed or suspended app cannot promise immediate alerts without an operating-system push service.

Google Cast's Android SDK is pinned to **22.3.1** through `androidPlayServicesCastFrameworkVersion` in `app.json`. The plugin defaults to `+`, which now resolves Cast 23 and a media-router dependency requiring Android 37 / AGP 9.1; Expo SDK 57 uses Android 36 / AGP 8.12. Keep this pin when regenerating native projects, and review the complete native toolchain before upgrading Cast. A first build needs network access to download uncached Maven artifacts; offline mode works only after those dependencies have been cached.

## Normal development

After installing a compatible development build:

```bash
npx expo start --dev-client
```

TypeScript, JavaScript and styles normally update through Fast Refresh. Rebuild after adding/removing native dependencies, changing native plugins or permissions, or updating the SDK/native runtime. An old installed binary may not match a newly upgraded JavaScript bundle.

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

`deepmerge` 4.3.1 has no published patched version for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). `patches/deepmerge+4.3.1.patch` uses own data properties when merging, preventing `__proto__` from changing the result's prototype. Tests cover poisoned source/target objects, nested values and both runtime entry points. `postinstall` must apply this patch. npm audit still reports seven low findings through Expo's dependency chain because it checks versions rather than local patches. No advisory is suppressed; the CI audit fails on moderate or higher findings. Replace the patch with an upstream release when one becomes available.

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

Studio Amount, EQ and dynamic tone sliders use the Expo 57 compatible `@react-native-community/slider` 5.2.0. Rebuild both development clients after installing this native dependency; Metro refresh alone cannot add its view. Older clients show a rebuild notice instead of rendering an unavailable slider.

Expo modules are built from source (`expo-build-properties.ios.usePrecompiledModules: false`) to avoid the Swift 6.3 precompiled-module interface mismatch with the installed Swift 6.4 / Xcode 27.1 toolchain. React Native can continue using its prebuilt core.

ExpoModulesJSI 57.1.3 includes Swift-interface cleanup for Swift 6.4's `__ObjC::` spelling as well as `__ObjC.`. The older local patch is no longer needed. Leaving these C++ extensions in the public interface prevents importing ExpoModulesJSI on Xcode 27.1.

Recent-server biometric sign-in uses the existing `expo-secure-store` native module, with `requireAuthentication: true` and a dedicated keychain service. Its config-plugin Face ID description explains saved-server sign-in. No new biometric library is required; rebuild an older client if its Face ID usage description is missing. Real-device verification requires an enrolled Face ID / Touch ID / strong Android biometric.

### macOS emulator launcher stability

The custom Android Emulator app bundle must launch the SDK's `emulator` launcher with the SDK and AVD directories configured, rather than invoking `qemu-system-aarch64` directly. Direct launches produced repeated macOS DYLD failures for `libandroid-emu-tracing.dylib`. The launcher establishes the emulator library paths and selects the test AVD.

The test Mac also recorded EGL/gfxstream segmentation faults. Its test AVD now uses software graphics and cold boots (`-gpu software -no-snapshot`), with the previous launcher and AVD settings backed up beside the original files. This avoids restoring incompatible graphics snapshots without wiping installed apps or user data. Verify a completed Android boot and usable app window after changing the host setup.

Android Auto DHU testing requires the full Android Auto app; the placeholder package in a Google APIs image cannot provide projection. Use a Play-enabled image or a connected test handset and complete Google's Android Auto setup before treating DHU connection attempts as app tests.

## Adaptive screens (October 2026)

`app.json` allows system orientation on Android and iOS. Rebuild native apps after changing orientation configuration or `withAdaptiveWindow`; Metro refresh alone cannot update the native orientation mask or install the hinge module.

The player uses live window dimensions, two columns on wide windows, and scrollable controls in short windows. Android WindowManager reports separating folds/occluding hinges through `AdaptiveWindow`: player panels straddle the fold, while sheets stay in a single usable pane. Browsing fills the window across a non-occluding crease; it is constrained to a pane only for a physical hinge gap. A normal unfolded crease is not treated as an occlusion. The floating player reclamps after resizing.

Simulator QA: iPhone 17 portrait and landscape, direct playlist chooser and Studio entry; Pixel Fold unfolded, folded cover display, half-open book posture and rotated tabletop posture. A local track kept playing and retained its position through fold/unfold. Physical dual-screen hardware with an occluding gap still needs device QA; synthetic geometry tests cover nonzero hinge widths and stale rotation geometry. Android and iOS native development builds passed; 91 mobile tests passed.
