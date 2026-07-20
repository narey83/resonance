// <copyright file="withFloatingOverlay.js" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>
//
// Ships the native floating-overlay music controller: declares the
// SYSTEM_ALERT_WINDOW ("Display over other apps") permission, copies the Kotlin
// sources into the app package on prebuild, and registers the ReactPackage in
// MainApplication. Android-only; a no-op on iOS.

const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KOTLIN_FILES = ['FloatingOverlayModule.kt', 'FloatingOverlayPackage.kt'];
// The package the Kotlin sources are authored under; rewritten to the app's real
// package (which differs per build variant, e.g. com.resonance.mobile.dev).
const TEMPLATE_PACKAGE = 'com.resonance.mobile';

const withFloatingOverlay = (config) => {
  // Resolved package reflects the active variant (app.config.js swaps in `.dev`).
  const androidPackage = config.android?.package || TEMPLATE_PACKAGE;

  // ── Permission ──────────────────────────────────────────────────────────────
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const perms = manifest['uses-permission'] ?? [];
    const name = 'android.permission.SYSTEM_ALERT_WINDOW';
    if (!perms.some((p) => p.$?.['android:name'] === name)) {
      perms.push({ $: { 'android:name': name } });
    }
    manifest['uses-permission'] = perms;
    return config;
  });

  // ── Copy Kotlin sources into the app package (repackaged to match) ───────────
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const srcDir = path.join(config.modRequest.projectRoot, 'plugins', 'overlay-native');
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java',
        androidPackage.replace(/\./g, '/'),
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of KOTLIN_FILES) {
        const source = fs.readFileSync(path.join(srcDir, file), 'utf8')
          .replace(`package ${TEMPLATE_PACKAGE}`, `package ${androidPackage}`);
        fs.writeFileSync(path.join(destDir, file), source);
      }
      return config;
    },
  ]);

  // ── Register the ReactPackage in MainApplication ─────────────────────────────
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('FloatingOverlayPackage()')) {
      // Same package as MainApplication, so no import is needed.
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        '$1\n          add(FloatingOverlayPackage())',
      );
    }
    config.modResults.contents = contents;
    return config;
  });

  return config;
};

module.exports = withFloatingOverlay;
