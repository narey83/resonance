# Expo Guide for React Native Development

A practical reference for working with this project as you learn the Expo ecosystem.

---

## The Three Ways to Run an Expo App

### 1. Expo Go (What you're using now)

Expo Go is a free app you install on your phone from the App Store or Play Store. It contains a pre-built JavaScript runtime with a fixed set of Expo SDK packages already compiled in.

**How it works:**
1. Run `npx expo start` in the `mobile/` directory
2. Scan the QR code with your phone's camera (iOS) or the Expo Go app (Android)
3. Your JavaScript code is bundled on your computer and sent to the phone over the network
4. Expo Go executes it inside its pre-built runtime

**Constraints:**
- You can only use packages that Expo Go already includes (official `expo-*` packages from the SDK)
- Any package that contains C/C++/NDK native code will **not work** in Expo Go
- No custom native configuration (e.g., custom Android permissions beyond the defaults)
- Fast to iterate — no build step needed, changes appear in seconds

**Good for:** Development and testing when you're using only official Expo packages.

---

### 2. Custom Dev Client

A custom dev client is like Expo Go, but you build it yourself. This gives you a development app that includes whatever native packages you need.

**This project uses a local ADB build (not EAS).** The app is compiled on your machine and installed directly to a connected Android device via USB.

**How it works:**
1. `npx expo run:android` — compiles the native APK locally and installs it on your device via ADB
2. Metro bundler starts automatically and stays running
3. **JS changes hot reload instantly** via Fast Refresh — no rebuild needed
4. Only rebuild when native code changes (see below)

**When you need a full rebuild (`npx expo run:android`):**
- Adding or removing a package with native code
- Changing `app.json` (permissions, plugins, bundle ID, package name)
- Updating the Expo SDK version

**When you do NOT need a rebuild (just run `npx expo start`):**
- Any JavaScript/TypeScript change
- Styles, components, API calls, screens
- Adding a JS-only package

**Fast Refresh workflow:**
- If Metro is already running from a previous `expo run:android` — just save your file, the app updates automatically
- If Metro isn't running — `npx expo start` connects to the already-installed app, no rebuild needed
- Force a full reload: shake the phone → "Reload", or press `r` in the Metro terminal

**Cost:** No cloud build needed — requires Android SDK + JDK 17 installed locally and a device connected via USB with USB debugging enabled.

---

### 3. Production Build

The final app you'd ship to the App Store or Play Store.

**How it works:**
1. `eas build --profile production`
2. EAS compiles everything (your JS + all native packages) into a single app binary
3. No Metro bundler needed at runtime — everything is bundled in

**Key difference from dev:** No live reload, no dev menu, fully optimised and minified. This is what users actually install.

---

## Package Compatibility Rules

### The golden rule

> Always use `npx expo install <package>` — never `npm install <package>` for Expo packages.

`npx expo install` automatically selects the version that is compatible with your current SDK version. `npm install` picks the latest version, which may not match and will cause subtle build failures.

### Which packages work in Expo Go?

| Works in Expo Go | Does NOT work in Expo Go |
|---|---|
| Official `expo-*` packages | Any package with C/NDK code |
| `react-native-*` packages that are JS-only | `react-native-zeroconf` |
| `axios`, `zustand`, `@react-navigation/*` | Custom native modules |
| Packages in the [Expo SDK reference](https://docs.expo.dev/versions/latest/) | Most camera/Bluetooth/NFC libraries |

The quick test: if a package's README says "run `npx pod-install`" or mentions Android NDK, it needs a custom dev client.

### This project's packages (all Expo Go compatible)

```
expo-audio          — Audio playback
expo-linear-gradient — Gradient backgrounds  
expo-network        — Get device IP address
expo-secure-store   — Encrypted key-value storage
expo-constants      — Device/app constants
react-native-svg    — SVG rendering
```

The network discovery in `ConnectScreen.tsx` uses `expo-network` + `axios` to scan the local subnet — this is pure JavaScript and works in Expo Go. An earlier version used `react-native-zeroconf` (C/NDK code) which required a custom build; that has been removed.

---

## SDK Version Numbers

Expo releases new SDK versions (SDK 50, 51, 52… 56) roughly every quarter. This project uses **SDK 56**.

Package versions are tied to the SDK:

```json
"expo": "~56.0.5",
"expo-audio": "~56.0.11",
"expo-network": "~56.0.4"
```

The `~` prefix means "compatible patch versions" (e.g., `~56.0.4` accepts `56.0.4`, `56.0.5`, but not `56.1.0`).

EAS validates these versions before building. A mismatch (e.g., `expo@56.0.4` when `~56.0.5` is required) causes the build to fail in the "Install dependencies" phase within seconds — before any compilation happens.

**Fix:** `npx expo install expo react-native-safe-area-context react-native-svg` (or whichever packages are mismatched).

---

## Day-to-Day Workflow

### First-time setup (or after native changes)

```bash
cd mobile
npx expo run:android    # Build native APK and install via ADB
```

Requires a device connected via USB with USB debugging enabled. Takes ~4 minutes the first time; faster on subsequent runs due to Gradle build cache.

### Normal development (JS changes)

```bash
cd mobile
npx expo start          # Start Metro — app on phone hot reloads automatically
```

The app must already be installed from a previous `expo run:android`. Save any `.ts`/`.tsx` file and Fast Refresh updates the app in under a second.

### Adding a new package

```bash
# Always use this, not npm install
npx expo install expo-camera

# For non-Expo packages (JS-only), npm install is fine
npm install date-fns
```

If the package has native code, run `npx expo run:android` after installing. JS-only packages take effect immediately via `npx expo start`.

### Checking TypeScript types

```bash
npx tsc --noEmit
```

Run this before committing to catch type errors without building.

### Triggering a full reload

- Shake your phone → "Reload" in the dev menu
- Or press `r` in the terminal where Metro is running

---

## The `app.json` Plugins Array

Some Expo packages need to run code at build time to configure Android/iOS projects. These are listed in the `plugins` array in `app.json`.

```json
{
  "expo": {
    "plugins": [
      "expo-audio"
    ]
  }
}
```

`expo-audio` adds Android permissions (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, etc.) automatically when listed here.

**Not everything goes in plugins.** Auto-linked packages like `expo-linear-gradient` and `react-native-svg` do not need a plugin entry — they configure themselves through the standard React Native auto-linking mechanism.

---

## EAS (Expo Application Services)

EAS is Expo's cloud build service. Builds run on Expo's servers — you don't need Android Studio or Xcode installed locally.

### Build profiles (`eas.json`)

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "production": {}
  }
}
```

- `development` — builds a custom dev client for testing with native packages
- `production` — builds the final app for store submission

### Useful commands

```bash
eas build --platform android --profile production
eas build --platform android --profile development
eas build:list     # See recent builds and their status
```

---

## Quick Reference

| Situation | Command |
|---|---|
| First run / native change | `npx expo run:android` |
| JS-only change | `npx expo start` |
| Force reload on device | Shake → Reload, or press `r` in Metro |
| Add a package | `npx expo install <package>` |
| Fix SDK version mismatches | `npx expo install expo react-native-safe-area-context react-native-svg` |
| Type-check | `npx tsc --noEmit` |
| Production build | `eas build --platform android --profile production` |

| Change type | Command needed | Rebuild? |
|---|---|---|
| `.ts` / `.tsx` file | `npx expo start` (or already running) | No |
| JS-only npm package | `npx expo start` | No |
| Native package added | `npx expo run:android` | Yes |
| `app.json` changed | `npx expo run:android` | Yes |
| SDK version bumped | `npx expo run:android` | Yes |
