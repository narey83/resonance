# Native mobile screenshots

These images support the [Android and iOS feature guide](../../../mobile/README.md) and the [main README](../../../README.md#android-and-ios). They show the native companion apps, not the desktop web app at a narrow viewport.

Captured **21 October 2026**, using the isolated 15-track server library. Features, layouts and platform availability can change as development continues and more features are added.

## Capture setup

| Platform | Device | OS | Native frame | Build |
| --- | --- | --- | --- | --- |
| Android | Pixel 9 emulator | Android 16 / API 36 | 1080×2424 | Local arm64 development build |
| iOS | iPhone 17 simulator | iOS 27.0 | 1206×2622 | Local arm64 simulator development build |

The library, tracks, player and queue use the mobile **Dark** palette. Mixtape and settings captures use **Light**. The artwork background gives the full player its own colours in both themes. Native mobile palettes and controls are separate from the desktop web themes.

The captures use the current UI source with the existing local Expo/runtime and playback-service updates. Those pre-existing source changes are not part of the screenshot/documentation update. Android was built in a separate capture checkout without the private Firebase configuration and with Google Cast pinned to 22.3.1. An unbounded Cast dependency selected a newer media-router dependency incompatible with the current Android build toolchain. These capture-only packaging choices do not validate push delivery or physical casting. Development menus and tool overlays were dismissed before capture.

During Android capture setup, navigation stopped responding after the first sign-in and development-menu interaction. Restarting the app restored navigation; the cause was not established and no source fix is claimed. The screenshots were taken after normal screen navigation resumed.

[`manifest.json`](manifest.json) records the source revision, local-source fingerprint, capture time, platform, theme, frame size and image checksum. Keep the original native frame and use stable filenames when recapturing.

## Screens

Each platform directory contains the same six views:

| File | View |
| --- | --- |
| `albums.png` | Server library with medium album artwork tiles |
| `tracks.png` | Server track list, available BPM/key and mini-player |
| `player.png` | High Energy in the full player with artwork, waveform and available analysis metadata |
| `queue.png` | Player queue with the current track highlighted |
| `mixtape.png` | Workbench test set, three saved tracks and ordering controls |
| `settings.png` | Light-mode appearance and playback preferences |

The images establish what was visible in those builds. They do not establish Android Auto/CarPlay compatibility, casting to physical receivers, notification delivery, local music-library access on iOS, USB-drive writing or store approval. See the [platform comparison](../../../mobile/README.md#platform-differences) for the implementation's current differences.

## Recapture

1. Build or install a compatible native development app following the [Expo guide](../../../mobile/EXPO_GUIDE.md). Use an isolated server and suitable test music.
2. Start Metro with `npx expo start --dev-client`, connect the native app and sign in normally. Keep credentials, QR codes and signed stream URLs out of screenshots and manifests.
3. Set the native frame, appearance, text size and status bar consistently. Open the real screens and wait for library metadata, artwork and waveforms to load. Do not substitute mock screens or fabricated results.
4. Capture the device framebuffer into a review directory using the native tools:

```bash
# Find a running iOS simulator, then use its identifier
xcrun simctl list devices booted
export IOS_DEVICE='your-simulator-udid'
xcrun simctl io "$IOS_DEVICE" screenshot /tmp/resonance-ios-albums.png

# Find the Android emulator/device, then use its serial
adb devices
export ANDROID_SERIAL='emulator-5554'
adb -s "$ANDROID_SERIAL" exec-out screencap -p > /tmp/resonance-android-albums.png
```

5. Inspect every image at full size. Exclude development overlays, loading states, errors, passwords, pairing codes, private messages, peer details and non-test server paths. Do not present a stale image as a new capture.
6. Copy approved PNGs into `android/` or `ios/`, update their manifest entries and review all Markdown image links. Retain accurate capture dates for images that were not replaced.

Playing tracks and changing themes can update the test account's history and preferences. These captures did not start Soulseek transfers, alter USB media, publish mixtapes or send chat messages. Exit the capture apps and development servers when finished.
