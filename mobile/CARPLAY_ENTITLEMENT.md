# CarPlay entitlement and release checklist

Last updated: 24 October 2026.

## Current status

The iOS CarPlay integration is implemented. Apple entitlement approval has **not** been requested or verified as part of this work. Adding the entitlement to the project does not grant Apple's approval or make a device provisioning profile eligible for CarPlay.

| Setting | Value |
| --- | --- |
| App | Resonance |
| Bundle identifier | `com.resonance.mobile` |
| CarPlay category | Audio |
| Entitlement | `com.apple.developer.carplay-audio` |
| Entitlement value | Boolean `true` |

## Request approval later

1. Use the Apple Developer account/team that will sign and distribute Resonance.
2. Follow [Apple's CarPlay entitlement request guide](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements) to reach the CarPlay request form, select the audio category and complete the required agreement/addendum.
3. Describe the actual car experience: browsing and playing the user's local music or music from their connected Resonance server, with playlists and standard Now Playing controls. CarPlay uses the phone's existing playback queue.
4. Submit the requested app and business details, then retain Apple's response. Approval and any requested changes must be resolved before treating device/distribution support as ready.

Suggested description to adapt to the form:

> Resonance is a music player for audio imported onto the iPhone and music streamed from a user's connected Resonance server. Its CarPlay audio interface provides library, artist, album, folder and playlist browsing, plus Apple's standard Now Playing controls. Playback and the queue remain synchronized with the iPhone app. Local music can be used without a server account.

The account holder should review and accept any Apple agreements. This document does not record acceptance or submit a request.

## After Apple approves

1. Confirm that the CarPlay audio managed capability is available for the team's explicit App ID matching `com.resonance.mobile`.
2. Enable/configure the approved capability for that App ID as directed by Apple.
3. Regenerate or refresh the development and distribution provisioning profiles. If using managed signing or EAS, refresh the corresponding signing credentials there too.
4. Build with the same team, bundle identifier and profiles. Confirm that the signed app and embedded profile both permit the audio entitlement; a value in the source plist alone is insufficient.
5. Test on a physical iPhone and CarPlay display before submitting. Follow Apple's current CarPlay and App Store review requirements.

Apple's [entitlement guide](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements) is the source of truth for approval and signing requirements.

## Configuration already in this repository

- [`app.json`](app.json) enables [`plugins/withCarPlay.js`](plugins/withCarPlay.js).
- The plugin adds the audio entitlement, audio background mode and `CPTemplateApplicationScene` configuration, with `ResonanceCarPlaySceneDelegate` as delegate. It preserves Expo's phone scene.
- [`carplay-native/ResonanceCarPlay.mm`](carplay-native/ResonanceCarPlay.mm) implements the native browser and scene lifecycle; [`src/services/carPlay.ts`](src/services/carPlay.ts) connects it to the shared library and player.
- The local CocoaPod is defined in [`carplay-native/ResonanceCarPlay.podspec`](carplay-native/ResonanceCarPlay.podspec).

Apply native changes through the Expo plugin rather than editing generated iOS files alone. Regenerate the iOS project with the project's Expo prebuild workflow, install CocoaPods dependencies and rebuild the native app. Metro reloads cannot install an entitlement, scene delegate or native pod. Use the repository's documented build setup and signing configuration.

Open the upgraded app once while the iPhone is unlocked so existing session keys can migrate for subsequent locked-phone access. Biometric saved-server passwords remain separately protected. Test launches after the first unlock following a device restart.

## Testing before release

The native simulator build, phone launch and automated browser/queue tests passed during implementation. The actual CarPlay interface and physical-device lifecycle remain unverified.

This Mac's Xcode Device Hub could not project an iOS simulator into CarPlay. Apple's [Xcode 27.2 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_2-release-notes) list USB-connected physical devices as required for Device Hub CarPlay support. Re-check the installed Xcode version's release notes when returning to this task; tooling support may change.

- [ ] App appears on a physical CarPlay display with an approved development profile.
- [ ] CarPlay launches playback when the phone app was not already running.
- [ ] Locked-phone launch works after the first device unlock; unavailable credentials produce a recoverable state.
- [ ] Local mode works without an account and does not expose a remembered server.
- [ ] Connected-server browsing and playback work, including expired sessions and loss of connectivity.
- [ ] Play/pause, next/previous, seeking, metadata and artwork match the phone player.
- [ ] Queue changes remain synchronized between phone and CarPlay.
- [ ] Large libraries, paged lists, deeply nested folders, Back and Refresh work.
- [ ] Calls, Siri, audio interruptions, disconnects and reconnects recover correctly.
- [ ] Wired and wireless CarPlay are tested where supported by the available hardware.
- [ ] A distribution-signed build is checked before App Store submission.

## Approval record

Fill these in when the request is made. Keep credentials, signing keys and provisioning files out of this document.

| Item | Record |
| --- | --- |
| Apple Developer team | Pending |
| Request date/reference | Pending |
| Approval date | Pending |
| Approved App ID | Pending |
| Development profile refreshed | Pending |
| Distribution profile refreshed | Pending |
| Device/CarPlay hardware and iOS version tested | Pending |
| Test results and remaining issues | Pending |
