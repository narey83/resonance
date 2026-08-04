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

    // NOTE: react-native-track-player 5.x already declares its MusicService
    // (with the MediaLibraryService / MediaBrowserService intent-filters) in its
    // own library manifest, so we intentionally do NOT add a <service> here — a
    // duplicate declaration would conflict during manifest merge.

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

      // Artwork placeholder for tracks/folders with no cover. It has to be a real Android
      // resource, not a bundled JS asset: the patched MusicService hands Android Auto an
      // `android.resource://<pkg>/drawable/resonance_placeholder` URI, which the car's own
      // process opens over the ContentResolver.
      fs.mkdirSync(path.join(resDir, 'drawable-nodpi'), { recursive: true });
      fs.copyFileSync(
        path.join(config.modRequest.projectRoot, 'assets/icon.png'),
        path.join(resDir, 'drawable-nodpi/resonance_placeholder.png'),
      );
      return config;
    },
  ]);

  return config;
};

module.exports = withAndroidAuto;
