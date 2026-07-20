// <copyright file="DbConfigurationSource.cs" company="John Narey">
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

namespace resonance.Configuration
{
    using Microsoft.Extensions.Configuration;
    using resonance.Core.Settings;

    /// <summary>
    ///     A <see cref="ConfigurationProvider"/> backed by the <see cref="SettingsService"/> database table.
    /// </summary>
    /// <remarks>
    ///     This provider replaces the legacy YAML file layer. It loads the flattened settings rows verbatim,
    ///     so the bound <c>Options</c> object is identical to what the YAML layer produced. Because settings
    ///     are edited in-process (via the API), a write is followed by <see cref="DbConfigurationSource.Reload"/>,
    ///     which re-reads the table and fires the change token so <c>IOptionsMonitor&lt;Options&gt;</c> re-binds.
    /// </remarks>
    public class DbConfigurationProvider : ConfigurationProvider
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="DbConfigurationProvider"/> class.
        /// </summary>
        /// <param name="settings">The settings store to read from.</param>
        public DbConfigurationProvider(SettingsService settings)
        {
            Settings = settings;
        }

        private SettingsService Settings { get; }

        /// <summary>
        ///     Loads the settings rows into the configuration data.
        /// </summary>
        public override void Load()
        {
            // clear before repopulating so array and dictionary keys don't get "stuck" on reload
            Data.Clear();

            // Keys are stored retaining the document's snake_case so the UI can round-trip them; the binder
            // expects them normalized (lowercased, underscores/hyphens removed), matching the YAML provider.
            foreach (var (key, value) in Settings.GetAll())
            {
                Data[SettingsYaml.Normalize(key)] = value;
            }
        }

        /// <summary>
        ///     Re-reads the settings table and notifies configuration consumers of the change.
        /// </summary>
        public void Reload()
        {
            Load();
            OnReload();
        }
    }

    /// <summary>
    ///     Represents the database settings table as an <see cref="IConfigurationSource"/>.
    /// </summary>
    /// <remarks>
    ///     A single instance is shared across every configuration root (mirroring
    ///     <see cref="VolatileOverlayConfigurationSource{T}"/>) so that <see cref="Reload"/> propagates to all of them.
    /// </remarks>
    public class DbConfigurationSource : IConfigurationSource
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="DbConfigurationSource"/> class.
        /// </summary>
        /// <param name="settings">The settings store to read from.</param>
        public DbConfigurationSource(SettingsService settings)
        {
            Provider = new DbConfigurationProvider(settings);
        }

        private DbConfigurationProvider Provider { get; }

        /// <summary>
        ///     Re-reads the settings table and notifies configuration consumers of the change.
        /// </summary>
        public void Reload() => Provider.Reload();

        /// <summary>
        ///     Returns the shared <see cref="DbConfigurationProvider"/> for this source.
        /// </summary>
        /// <param name="builder">The <see cref="IConfigurationBuilder"/>.</param>
        /// <returns>The shared <see cref="DbConfigurationProvider"/>.</returns>
        public IConfigurationProvider Build(IConfigurationBuilder builder) => Provider;
    }
}
