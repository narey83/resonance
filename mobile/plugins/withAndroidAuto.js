// <copyright file="withAndroidAuto.js" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const CAR_META_KEY  = 'com.google.android.gms.car.application';
const MUSIC_SERVICE = 'com.doublesymmetry.trackplayer.service.MusicService';

const withAndroidAuto = (config) => {

  // ── Manifest changes ───────────────────────────────────────────────────────
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app      = manifest.application[0];

    // Permissions
    const perms = manifest['uses-permission'] ?? [];
    const addPerm = (name) => {
      if (!perms.some((p) => p.$?.['android:name'] === name)) {
        perms.push({ $: { 'android:name': name } });
      }
    };
    addPerm('android.permission.FOREGROUND_SERVICE');
    addPerm('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    // Lets the app ask the user to ignore battery optimizations so Doze doesn't
    // suspend background playback when the screen locks while unplugged.
    addPerm('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    manifest['uses-permission'] = perms;

    // Android Auto: <uses-feature> declarations
    const features = manifest['uses-feature'] ?? [];
    const addFeature = (name) => {
      if (!features.some((f) => f.$?.['android:name'] === name)) {
        features.push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    };
    addFeature('android.software.leanback');
    addFeature('android.hardware.touchscreen');
    manifest['uses-feature'] = features;

    // Android Auto meta-data on <application>
    if (!app['meta-data']) app['meta-data'] = [];
    if (!app['meta-data'].some((m) => m.$?.['android:name'] === CAR_META_KEY)) {
      app['meta-data'].push({
        $: {
          'android:name':     CAR_META_KEY,
          'android:resource': '@xml/automotive_app_desc',
        },
      });
    }

    // react-native-track-player 5.x declares MusicService itself (with the MediaLibraryService /
    // MediaBrowserService intent-filters), so this adds nothing but an icon and lets the manifest
    // merger fold it into that declaration — the car shows the media service's icon, and the app's
    // own launcher icon is bright blue, which is wrong against Android Auto's dark UI.
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    app.service = app.service ?? [];
    if (!app.service.some((s) => s.$?.['android:name'] === MUSIC_SERVICE)) {
      app.service.push({
        $: {
          'android:name': MUSIC_SERVICE,
          'android:icon': '@mipmap/ic_launcher_aa',
          'tools:node':   'merge',
          // The class lives in the RNTP library, so lint can't resolve it from the app module.
          'tools:ignore': 'Instantiatable',
        },
      });
    }

    return config;
  });

  // ── automotive_app_desc.xml + placeholder artwork resources ────────────────
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const resDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
      fs.mkdirSync(path.join(resDir, 'xml'), { recursive: true });
      fs.writeFileSync(
        path.join(resDir, 'xml/automotive_app_desc.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n    <uses name="media"/>\n</automotiveApp>\n',
      );

      // Artwork placeholder for tracks/folders with no cover — a dark tile, deliberately not the
      // blue app icon, which was too loud repeated down a list. It has to be a real Android
      // resource, not a bundled JS asset: the patched MusicService hands Android Auto an
      // `android.resource://<pkg>/drawable/resonance_placeholder` URI, which the car's own
      // process opens over the ContentResolver.
      fs.mkdirSync(path.join(resDir, 'drawable-nodpi'), { recursive: true });
      fs.copyFileSync(
        path.join(config.modRequest.projectRoot, 'assets/aa-placeholder.png'),
        path.join(resDir, 'drawable-nodpi/resonance_placeholder.png'),
      );
      // The icon the car shows for the app itself (see the <service> above). Its backing layer is
      // white to match the circular plate the car draws behind every app icon — anything else
      // leaves that plate's edge showing as a ring around the logo. It has to be an
      // adaptive icon: the car draws a circular badge and insets a plain drawable into it, which
      // left a white ring around a dark square. Adaptive icons get masked to the circle instead.
      fs.mkdirSync(path.join(resDir, 'mipmap-anydpi-v26'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'mipmap-nodpi'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'values'), { recursive: true });
      fs.copyFileSync(
        path.join(config.modRequest.projectRoot, 'assets/aa-icon-foreground.png'),
        path.join(resDir, 'drawable-nodpi/resonance_aa_foreground.png'),
      );
      fs.copyFileSync(
        path.join(config.modRequest.projectRoot, 'assets/aa-app-icon.png'),
        path.join(resDir, 'mipmap-nodpi/ic_launcher_aa.png'),
      );
      fs.writeFileSync(
        path.join(resDir, 'mipmap-anydpi-v26/ic_launcher_aa.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/aa_icon_background"/>\n    <foreground android:drawable="@drawable/resonance_aa_foreground"/>\n</adaptive-icon>\n',
      );
      fs.writeFileSync(
        path.join(resDir, 'values/aa_icon.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="aa_icon_background">#FFFFFF</color>\n</resources>\n',
      );
      return config;
    },
  ]);

  return config;
};

module.exports = withAndroidAuto;
