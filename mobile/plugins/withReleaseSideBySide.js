// <copyright file="withReleaseSideBySide.js" company="John Narey">
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

const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// A Metro dev bundle is materially slower than a release one, so comparing them means having both
// installed at once. Give release its own application id and launcher label; debug (the dev client)
// keeps the canonical id so nothing about the existing workflow changes.
//
// This lives in a plugin rather than as an edit to android/app/build.gradle because /android is
// gitignored and regenerated — a direct edit works until the next prebuild silently reverts it.
//
// Consequence worth knowing: a different application id means different storage, so the release
// build starts logged out and keeps its own library cache.
const SUFFIX = '.prod';
const LABEL = 'Resonance Prod';

const withReleaseApplicationId = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSideBySide: expected a groovy build.gradle');
    }

    if (cfg.modResults.contents.includes(`applicationIdSuffix '${SUFFIX}'`)) {
      return cfg;
    }

    // Anchor on the signingConfig line inside buildTypes.release, which Expo's template always
    // emits. Throwing beats silently producing a release build that overwrites the dev client.
    const anchor = /(release\s*\{\s*\n)/;
    if (!anchor.test(cfg.modResults.contents)) {
      throw new Error('withReleaseSideBySide: could not find the release buildType');
    }

    cfg.modResults.contents = cfg.modResults.contents.replace(
      anchor,
      `$1            applicationIdSuffix '${SUFFIX}'\n`,
    );

    return cfg;
  });

// Build-type resource override: applies to release only, leaving debug labelled "Resonance".
const withReleaseLabel = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'release',
        'res',
        'values',
      );

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'strings.xml'),
        `<resources>\n  <string name="app_name">${LABEL}</string>\n</resources>\n`,
      );

      return cfg;
    },
  ]);

module.exports = (config) => withReleaseLabel(withReleaseApplicationId(config));
