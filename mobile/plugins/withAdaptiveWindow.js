const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KOTLIN_FILES = ['AdaptiveWindowModule.kt', 'AdaptiveWindowPackage.kt'];
// The package the Kotlin sources are authored under; rewritten to the app's real
// package (which differs per build variant, e.g. com.resonance.mobile.dev).
const TEMPLATE_PACKAGE = 'com.resonance.mobile';

const withAdaptiveWindow = (config) => {
  // Resolved package reflects the active variant (app.config.js swaps in `.dev`).
  const androidPackage = config.android?.package || TEMPLATE_PACKAGE;

  // ── Copy Kotlin sources into the app package (repackaged to match) ───────────
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const srcDir = path.join(config.modRequest.projectRoot, 'plugins', 'adaptive-native');
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
    if (!contents.includes('AdaptiveWindowPackage()')) {
      // Same package as MainApplication, so no import is needed.
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        '$1\n          add(AdaptiveWindowPackage())',
      );
    }
    config.modResults.contents = contents;
    return config;
  });

  config = withAppBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('androidx.window:window-java:')) {
      mod.modResults.contents += '\ndependencies { implementation("androidx.window:window-java:1.4.0") }\n';
    }
    return mod;
  });
  return config;
};

module.exports = withAdaptiveWindow;
