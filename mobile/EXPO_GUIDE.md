# Mobile development with Expo

Updated **21 October 2026** for the current Expo SDK 57 source. Dependencies and native tooling can change; check `package.json`, `app.json`, the lockfile and the [versioned Expo SDK documentation](https://docs.expo.dev/versions/v57.0.0/) before making changes.

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

The configured Android Firebase file, `google-services.json`, is private and intentionally ignored. Supply your own project's file when building with that configuration. The CI workflow obtains it from a repository secret. A capture or test build that deliberately omits push configuration must not be described as a push-delivery test.

The 21 October screenshot build also needed a fixed Google Cast Android dependency: the plugin's default `+` selected a media-router release requiring a newer Android Gradle plugin. The isolated capture build used Cast 22.3.1. The plugin exposes `androidPlayServicesCastFrameworkVersion` for a durable version pin; see the [capture notes](../docs/screenshots/mobile/README.md#capture-setup). Review native dependency compatibility before treating a fresh build as reproducible.

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

Use an isolated server/library when testing downloads, file management, mixtape edits or playback history. Never commit credentials, pairing codes, signed stream URLs, Firebase credentials or captured private messages.

## Checks

```bash
npx eslint .
npx tsc --noEmit
```

Then build and exercise the affected platform. Type checks cannot validate native linking, background playback, notification delivery, device permissions, casting or Android Auto. Screenshots are visual evidence for the displayed screens, not a substitute for those integration tests.

## Distribution

`eas.json` defines development, preview and production profiles. Local builds do not require an EAS cloud build. The repository's CI/release workflows build Android APKs; production store distribution and iOS signing/provisioning need their own configuration and validation.

Feature descriptions, platform differences and the current gallery live in the [mobile guide](README.md). Native screenshot capture instructions live in the [screenshot guide](../docs/screenshots/mobile/README.md).
