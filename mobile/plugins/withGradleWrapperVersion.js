// <copyright file="withGradleWrapperVersion.js" company="John Narey">
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

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// @react-native/gradle-plugin (as of RN 0.85.3 / 0.86.0) ships a
// gradle-wrapper.properties pinned to Gradle 9.3.1 while its own
// libs.versions.toml pins AGP 8.12.0, which requires Gradle 8.13.
// That mismatch breaks the build with:
//   "Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member
//    field 'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'"
// Pin the wrapper back down to the version AGP actually supports until
// upstream fixes the template.
const GRADLE_VERSION = '8.13';

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    (config) => {
      const wrapperPropsPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );
      const contents = fs.readFileSync(wrapperPropsPath, 'utf8');
      fs.writeFileSync(
        wrapperPropsPath,
        contents.replace(
          /distributionUrl=.*gradle-[\d.]+-bin\.zip/,
          `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`
        )
      );
      return config;
    },
  ]);
