// <copyright file="app.config.js" company="John Narey">
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

// Dynamic config layered on top of app.json. Selecting the `development` variant
// (via APP_VARIANT=development, set by the dev/preview EAS profiles and local runs)
// gives the build a distinct package name and display name so it installs
// side by side with a production build instead of colliding with it.
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Resonance Dev' : 'Resonance',
  // Dev variant gets an orange-ribboned icon so it's distinguishable on the home screen.
  icon: IS_DEV ? './assets/icon-dev.png' : config.icon,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'com.resonance.mobile.dev' : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: IS_DEV ? 'com.resonance.mobile.dev' : config.android.package,
    adaptiveIcon: {
      ...config.android.adaptiveIcon,
      // Same Resonance logo in the foreground, but a solid dev-orange background.
      ...(IS_DEV
        ? {
            backgroundColor: '#FF6D00',
            backgroundImage: './assets/android-icon-background-dev.png',
          }
        : {}),
    },
  },
});
